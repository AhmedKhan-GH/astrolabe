import { join } from 'node:path'
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import type { Db } from '../db'
import * as s from '../db/schema'
import {
  createVCollectionRequestSchema,
  deleteVCollectionRequestSchema,
  vcollectionMembersRequestSchema,
} from '../../shared/db-ipc'
import { moduleLogger } from './logger'
import { slugify as slugifyBase } from './slug'

/**
 * Virtual collections (docs/2026-07-10-lens-virtual-collections-spec) — the M:N, source-independent
 * grouping that dissolves the Zotero↔Eagle split: one document in many collections regardless of
 * which tool holds the bytes. Same law as saved views and everything else: the FILE is truth
 * (`<workspace>/.astrolabe/collections/<slug>.json`, rides file-sync, survives rebuilds,
 * hand-editable); SQLite is a derived mirror (`virtual_collections` + `virtual_collection_members`)
 * that exists only so browse/search/nav can join against membership in SQL.
 */
const log = moduleLogger('vcollections')

const SOURCE_KEYS = ['zotero', 'eagle', 'obsidian'] as const

/**
 * A member reference is hash-first ({hash} from `documents.contentSha256`, the rebuild-stable
 * content identity) with a {sourceKey, key} instance fallback for documents that have no content
 * hash yet (a note, an un-hashed attachment). Both are durable across an index rebuild — which is
 * the whole point: the file outlives the index.
 */
export const memberRefSchema = z.union([
  z.object({ hash: z.string().length(64) }),
  z.object({ sourceKey: z.enum(SOURCE_KEYS), key: z.string().max(500) }),
])
export type MemberRef = z.infer<typeof memberRefSchema>

/** The on-disk collection payload. `createdAt` is ISO; `members` is the ordered ref list. */
export const virtualCollectionFileSchema = z.object({
  schemaVersion: z.literal(1),
  name: z.string().min(1).max(120),
  createdAt: z.iso.datetime(),
  members: z.array(memberRefSchema).max(10_000),
})
export type VirtualCollectionFile = z.infer<typeof virtualCollectionFileSchema>

/** The rail/popover summary: resolved distinct-document `count`, plus the `unresolvedCount` of
 *  refs that currently point at no indexed document (retained in the file, excluded from mirror). */
export interface VCollectionSummary {
  slug: string
  name: string
  count: number
  unresolvedCount: number
}

/** Views' slug is bound to `view`; collections bind the empty-guard fallback to `collection`. */
const slugify = (name: string): string => slugifyBase(name, 'collection')

const refKey = (r: MemberRef): string => ('hash' in r ? `h:${r.hash}` : `k:${r.sourceKey}:${r.key}`)

function dedupeRefs(refs: MemberRef[]): MemberRef[] {
  const seen = new Set<string>()
  const out: MemberRef[] = []
  for (const r of refs) {
    const k = refKey(r)
    if (seen.has(k)) continue
    seen.add(k)
    out.push(r)
  }
  return out
}

/**
 * Resolve one member ref to a `documents.id`, or null if it currently points at no indexed
 * document. Hash refs join `documents.contentSha256`; instance refs join a (source, externalKey)
 * pair. A null is not an error — the document may reappear on the next sync, so the ref is retained
 * in the file and merely surfaces as an unresolved count.
 */
function resolveRef(db: Db, ref: MemberRef): number | null {
  if ('hash' in ref) {
    const doc = db
      .select({ id: s.documents.id })
      .from(s.documents)
      .where(eq(s.documents.contentSha256, ref.hash))
      .get()
    return doc?.id ?? null
  }
  const row = db
    .select({ documentId: s.documentInstances.documentId })
    .from(s.documentInstances)
    .innerJoin(s.sources, eq(s.documentInstances.sourceId, s.sources.id))
    .where(and(eq(s.sources.key, ref.sourceKey), eq(s.documentInstances.externalKey, ref.key)))
    .get()
  return row?.documentId ?? null
}

/**
 * Build the durable ref for a document id (add-members converts ids → refs main-side). Hash-first
 * (`contentSha256`); else the instance ref, preferring zotero > eagle > obsidian for determinism
 * so the same document always yields the same ref regardless of scan order.
 */
function refForDocument(db: Db, documentId: number): MemberRef | null {
  const doc = db.select().from(s.documents).where(eq(s.documents.id, documentId)).get()
  if (!doc) return null
  if (doc.contentSha256) return { hash: doc.contentSha256 }
  const instances = db
    .select({ sourceKey: s.sources.key, key: s.documentInstances.externalKey })
    .from(s.documentInstances)
    .innerJoin(s.sources, eq(s.documentInstances.sourceId, s.sources.id))
    .where(eq(s.documentInstances.documentId, documentId))
    .all()
  const order = (k: string): number => {
    const i = (SOURCE_KEYS as readonly string[]).indexOf(k)
    return i === -1 ? SOURCE_KEYS.length : i
  }
  const pick = [...instances].sort((a, b) => order(a.sourceKey) - order(b.sourceKey))[0]
  if (!pick) return null
  const parsed = memberRefSchema.safeParse({ sourceKey: pick.sourceKey, key: pick.key })
  return parsed.success ? parsed.data : null
}

/** Read + validate every collection file in `dir`, skipping (with a warn) any that is corrupt or
 *  schema-violating — a hand-edit gone wrong must never take down the rail. */
function readAllFiles(dir: string): { slug: string; file: VirtualCollectionFile }[] {
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch {
    return [] // dir absent (no collection created yet) — an empty rail, not an error
  }
  const out: { slug: string; file: VirtualCollectionFile }[] = []
  for (const name of names) {
    if (!name.endsWith('.json')) continue
    try {
      const file = virtualCollectionFileSchema.parse(JSON.parse(readFileSync(join(dir, name), 'utf-8')))
      out.push({ slug: name.slice(0, -'.json'.length), file })
    } catch (err) {
      log.warn({ err, file: name }, 'skipping unreadable or invalid virtual collection file')
    }
  }
  return out
}

/**
 * Replace the mirror wholesale from the files, in one transaction (spec §Mirror tables). Called at
 * boot after DB init, after every `index:sync`/`index:rebuild` (at the handler site), and after
 * every mutation. Unresolvable and duplicate refs are excluded from the mirror; the file keeps them.
 */
export function syncVirtualCollections(db: Db, dir: string): void {
  const files = readAllFiles(dir)
  db.transaction(() => {
    db.delete(s.virtualCollectionMembers).run()
    db.delete(s.virtualCollections).run()
    for (const { slug, file } of files) {
      const vcId = db
        .insert(s.virtualCollections)
        .values({ slug, name: file.name })
        .returning()
        .get().id
      const seen = new Set<number>()
      for (const ref of file.members) {
        const id = resolveRef(db, ref)
        if (id == null || seen.has(id)) continue
        seen.add(id)
        db.insert(s.virtualCollectionMembers).values({ vcId, documentId: id }).run()
      }
    }
  })
}

export interface VCollectionsApi {
  list: () => VCollectionSummary[]
  create: (raw: unknown) => VCollectionSummary
  remove: (raw: unknown) => boolean
  addMembers: (raw: unknown) => VCollectionSummary
  removeMembers: (raw: unknown) => VCollectionSummary
}

/**
 * `dir` (the workspace's `.astrolabe/collections/`) and `db` are injected so tests run against a
 * tmp dir + tmp DB. Every mutation rewrites the file atomically (tmp + rename) then re-mirrors, so
 * the SQL mirror is always current when a read path runs.
 */
export function createVCollectionsApi(dir: string, db: Db): VCollectionsApi {
  const fileFor = (slug: string): string => join(dir, `${slug}.json`)
  const remirror = (): void => syncVirtualCollections(db, dir)

  function readFile(slug: string): VirtualCollectionFile | null {
    try {
      return virtualCollectionFileSchema.parse(JSON.parse(readFileSync(fileFor(slug), 'utf-8')))
    } catch {
      return null
    }
  }

  function writeAtomic(slug: string, file: VirtualCollectionFile): void {
    mkdirSync(dir, { recursive: true })
    const dest = fileFor(slug)
    const tmp = `${dest}.${randomUUID()}.tmp`
    writeFileSync(tmp, JSON.stringify(file, null, 2) + '\n')
    renameSync(tmp, dest)
  }

  /** Resolve a file's refs to a summary: distinct resolved documents + the unresolved remainder. */
  function summaryFor(slug: string, file: VirtualCollectionFile): VCollectionSummary {
    const resolved = new Set<number>()
    let unresolvedCount = 0
    for (const ref of file.members) {
      const id = resolveRef(db, ref)
      if (id == null) unresolvedCount++
      else resolved.add(id)
    }
    return { slug, name: file.name, count: resolved.size, unresolvedCount }
  }

  /** Every valid collection, name-sorted. A corrupt file is skipped with a warn (never fatal). */
  function list(): VCollectionSummary[] {
    return readAllFiles(dir)
      .map(({ slug, file }) => summaryFor(slug, file))
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  /**
   * Upsert by slug. Creating an existing collection is NON-DESTRUCTIVE: members and `createdAt`
   * are preserved (a create request carries only a name — wiping membership on a name collision
   * would be data loss, unlike a saved-view save which carries the whole filter).
   */
  function create(raw: unknown): VCollectionSummary {
    const { name } = createVCollectionRequestSchema.parse(raw)
    const slug = slugify(name)
    const existing = readFile(slug)
    const file = virtualCollectionFileSchema.parse({
      schemaVersion: 1,
      name,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      members: existing?.members ?? [],
    })
    writeAtomic(slug, file)
    remirror()
    return summaryFor(slug, file)
  }

  /** Delete by slug; reports whether the file existed, then re-mirrors (idempotent). */
  function remove(raw: unknown): boolean {
    const { slug } = deleteVCollectionRequestSchema.parse(raw)
    let existed = true
    try {
      rmSync(fileFor(slug))
    } catch {
      existed = false // already gone — deletion is idempotent from the caller's view
    }
    remirror()
    return existed
  }

  function mustRead(slug: string): VirtualCollectionFile {
    const file = readFile(slug)
    if (!file) throw new Error(`unknown virtual collection: ${slug}`)
    return file
  }

  /** Convert the document ids to refs (hash-first), merge + dedupe, rewrite atomically, re-mirror. */
  function addMembers(raw: unknown): VCollectionSummary {
    const { slug, documentIds } = vcollectionMembersRequestSchema.parse(raw)
    const file = mustRead(slug)
    const added = documentIds
      .map((id) => refForDocument(db, id))
      .filter((r): r is MemberRef => r != null)
    const updated: VirtualCollectionFile = { ...file, members: dedupeRefs([...file.members, ...added]) }
    writeAtomic(slug, updated)
    remirror()
    return summaryFor(slug, updated)
  }

  /**
   * Drop every ref that resolves to one of the given document ids; refs resolving elsewhere (and
   * unresolvable refs — they match no id) are retained. Rewrite atomically, re-mirror.
   */
  function removeMembers(raw: unknown): VCollectionSummary {
    const { slug, documentIds } = vcollectionMembersRequestSchema.parse(raw)
    const file = mustRead(slug)
    const drop = new Set(documentIds)
    const kept = file.members.filter((ref) => {
      const id = resolveRef(db, ref)
      return id == null || !drop.has(id)
    })
    const updated: VirtualCollectionFile = { ...file, members: kept }
    writeAtomic(slug, updated)
    remirror()
    return summaryFor(slug, updated)
  }

  return { list, create, remove, addMembers, removeMembers }
}
