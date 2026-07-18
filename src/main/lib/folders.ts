import { join } from 'node:path'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { moduleLogger } from './logger'
import { slugify as slugifyBase } from './slug'

/**
 * Folders — the organization primitive (docs/2026-07-18-folders-spec). One
 * JSON file per folder under `<workspace>/.astrolabe/folders/`; files are
 * truth, the SQLite mirror (index/folder-mirror.ts) is derived. Store rules
 * (spec §3): nesting with a hard cycle guard, multi-membership with ref
 * dedupe, delete re-parents children, no operation ever touches documents.
 */
const log = moduleLogger('folders')

export const slugify = (name: string): string => slugifyBase(name, 'folder')

const hashRefSchema = z.object({ sha256: z.string().min(1) })
const pathRefSchema = z.object({ library: z.string().min(1), key: z.string().min(1) })
export const memberRefSchema = z.union([hashRefSchema, pathRefSchema])
export type FolderMemberRef = z.infer<typeof memberRefSchema>

export const folderFileSchema = z.object({
  schemaVersion: z.literal(1),
  name: z.string().min(1).max(120),
  parent: z.string().min(1).max(200).nullable(),
  members: z.array(memberRefSchema),
})
export type FolderFile = z.infer<typeof folderFileSchema>
export interface FolderRecord { slug: string; file: FolderFile }

export class FolderError extends Error {
  readonly code: 'NOT_FOUND' | 'CYCLE' | 'DUPLICATE' | 'BAD_PARENT'
  constructor(message: string, code: FolderError['code']) {
    super(message)
    this.code = code
  }
}

/** Hash refs equal by sha256; path refs by (library, key); shapes never cross-equal. */
export function refsEqual(a: FolderMemberRef, b: FolderMemberRef): boolean {
  if ('sha256' in a && 'sha256' in b) return a.sha256 === b.sha256
  if ('library' in a && 'library' in b) return a.library === b.library && a.key === b.key
  return false
}

/** First occurrence wins; order preserved (spec §2 members are ordered-as-filed). */
export function dedupeRefs(refs: FolderMemberRef[]): FolderMemberRef[] {
  const out: FolderMemberRef[] = []
  for (const ref of refs) if (!out.some((r) => refsEqual(r, ref))) out.push(ref)
  return out
}

/** Would setting `slug`.parent = `newParent` create a cycle? Walk ancestors of
 *  newParent; hitting `slug` (or newParent === slug) is a cycle. `folders` maps
 *  slug → parent slug. */
export function wouldCycle(
  folders: Map<string, string | null>,
  slug: string,
  newParent: string | null,
): boolean {
  let cursor = newParent
  const seen = new Set<string>()
  while (cursor != null) {
    if (cursor === slug) return true
    if (seen.has(cursor)) return true // pre-existing corruption reads as cycle: refuse
    seen.add(cursor)
    cursor = folders.get(cursor) ?? null
  }
  return false
}

export interface FoldersStore {
  list(): FolderRecord[]
  create(req: { name: string; parent?: string | null }): FolderRecord
  rename(slug: string, name: string): { record: FolderRecord; previousSlug: string }
  setParent(slug: string, parent: string | null): FolderRecord
  remove(slug: string): void
  addMembers(slug: string, refs: FolderMemberRef[]): FolderRecord
  removeMembers(slug: string, refs: FolderMemberRef[]): FolderRecord
}

/** `foldersDir` injected (the workspace's `.astrolabe/folders/`) so tests run
 *  against tmp dirs — reading-state precedent throughout. */
export function createFoldersStore(foldersDir: string): FoldersStore {
  const fileFor = (slug: string): string => join(foldersDir, `${slug}.json`)

  function readOne(slug: string): FolderFile | null {
    const path = fileFor(slug)
    if (!existsSync(path)) return null
    try {
      return folderFileSchema.parse(JSON.parse(readFileSync(path, 'utf-8')))
    } catch (err) {
      log.warn({ err, slug }, 'ignoring unreadable or invalid folder file')
      return null
    }
  }

  function writeOne(slug: string, file: FolderFile): void {
    mkdirSync(foldersDir, { recursive: true })
    const dest = fileFor(slug)
    const tmp = `${dest}.${randomUUID()}.tmp`
    writeFileSync(tmp, JSON.stringify(file, null, 2) + '\n')
    renameSync(tmp, dest)
  }

  function list(): FolderRecord[] {
    if (!existsSync(foldersDir)) return []
    const out: FolderRecord[] = []
    for (const entry of readdirSync(foldersDir)) {
      if (!entry.endsWith('.json')) continue
      const slug = entry.slice(0, -'.json'.length)
      const file = readOne(slug)
      if (file) out.push({ slug, file })
    }
    return out.sort((a, b) => a.slug.localeCompare(b.slug))
  }

  const parentMap = (records: FolderRecord[]): Map<string, string | null> =>
    new Map(records.map((r) => [r.slug, r.file.parent]))

  function mustRead(slug: string): FolderFile {
    const file = readOne(slug)
    if (!file) throw new FolderError(`no such folder: ${slug}`, 'NOT_FOUND')
    return file
  }

  function assertParentOk(records: FolderRecord[], slug: string, parent: string | null): void {
    if (parent == null) return
    if (!records.some((r) => r.slug === parent))
      throw new FolderError(`parent does not exist: ${parent}`, 'BAD_PARENT')
    if (wouldCycle(parentMap(records), slug, parent))
      throw new FolderError(`cycle: ${slug} → ${parent}`, 'CYCLE')
  }

  function create(req: { name: string; parent?: string | null }): FolderRecord {
    const slug = slugify(req.name)
    if (readOne(slug)) throw new FolderError(`folder exists: ${slug}`, 'DUPLICATE')
    const records = list()
    const parent = req.parent ?? null
    assertParentOk(records, slug, parent)
    const file: FolderFile = { schemaVersion: 1, name: req.name, parent, members: [] }
    writeOne(slug, file)
    return { slug, file }
  }

  function rename(slug: string, name: string): { record: FolderRecord; previousSlug: string } {
    const file = mustRead(slug)
    const nextSlug = slugify(name)
    if (nextSlug !== slug && readOne(nextSlug))
      throw new FolderError(`folder exists: ${nextSlug}`, 'DUPLICATE')
    const next: FolderFile = { ...file, name }
    writeOne(nextSlug, next)
    if (nextSlug !== slug) {
      // Children keep pointing at the folder: rewrite their parent refs, then
      // drop the old file (slug is the address, spec §5 rename semantics).
      for (const r of list()) {
        if (r.slug !== slug && r.file.parent === slug)
          writeOne(r.slug, { ...r.file, parent: nextSlug })
      }
      rmSync(fileFor(slug), { force: true })
    }
    return { record: { slug: nextSlug, file: next }, previousSlug: slug }
  }

  function setParent(slug: string, parent: string | null): FolderRecord {
    const file = mustRead(slug)
    assertParentOk(list(), slug, parent)
    const next: FolderFile = { ...file, parent }
    writeOne(slug, next)
    return { slug, file: next }
  }

  function remove(slug: string): void {
    const file = mustRead(slug)
    // Children re-parent to the removed folder's parent (spec §3: never
    // orphaned, never cascaded).
    for (const r of list()) {
      if (r.slug !== slug && r.file.parent === slug)
        writeOne(r.slug, { ...r.file, parent: file.parent })
    }
    rmSync(fileFor(slug), { force: true })
  }

  function addMembers(slug: string, refs: FolderMemberRef[]): FolderRecord {
    const file = mustRead(slug)
    const next: FolderFile = { ...file, members: dedupeRefs([...file.members, ...refs]) }
    writeOne(slug, next)
    return { slug, file: next }
  }

  function removeMembers(slug: string, refs: FolderMemberRef[]): FolderRecord {
    const file = mustRead(slug)
    const next: FolderFile = {
      ...file,
      members: file.members.filter((m) => !refs.some((r) => refsEqual(r, m))),
    }
    writeOne(slug, next)
    return { slug, file: next }
  }

  return { list, create, rename, setParent, remove, addMembers, removeMembers }
}
