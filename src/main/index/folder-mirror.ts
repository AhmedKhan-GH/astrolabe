import { and, eq } from 'drizzle-orm'
import type { Db } from '../db'
import * as s from '../db/schema'
import { moduleLogger } from '../lib/logger'
import type { FolderMemberRef, FoldersStore } from '../lib/folders'

/**
 * Files → mirror (folders spec §4). WHOLESALE rebuild: delete both tables,
 * reinsert from the store. Runs at boot, after every connector sync (new
 * documents can resolve pending refs), and after every folders mutation.
 * The mirror never writes files; row ids are rebuild-local (slug = address).
 */
const log = moduleLogger('folder-mirror')

function resolveRef(db: Db, ref: FolderMemberRef): number | null {
  if ('sha256' in ref) {
    return (
      db.select({ id: s.documents.id }).from(s.documents)
        .where(eq(s.documents.contentSha256, ref.sha256)).get()?.id ?? null
    )
  }
  // path ref: `library` is `${connectorKey}:${stableKey}` (spec §2)
  const sep = ref.library.indexOf(':')
  if (sep < 0) return null
  const connectorKey = ref.library.slice(0, sep)
  const stableKey = ref.library.slice(sep + 1)
  const row = db
    .select({ documentId: s.documentInstances.documentId })
    .from(s.documentInstances)
    .innerJoin(s.libraries, eq(s.documentInstances.libraryId, s.libraries.id))
    .innerJoin(s.connectors, eq(s.libraries.connectorId, s.connectors.id))
    .where(
      and(
        eq(s.connectors.key, connectorKey),
        eq(s.libraries.stableKey, stableKey),
        eq(s.documentInstances.externalKey, ref.key),
      ),
    )
    .get()
  return row?.documentId ?? null
}

export function syncFolders(db: Db, store: FoldersStore): void {
  const records = store.list()
  db.transaction(() => {
    db.delete(s.folderMembers).run()
    db.delete(s.folders).run()
    const idBySlug = new Map<string, number>()
    for (const r of records) {
      const row = db.insert(s.folders)
        .values({ slug: r.slug, name: r.file.name, parentId: null })
        .returning().get()
      idBySlug.set(r.slug, row.id)
    }
    for (const r of records) {
      if (r.file.parent == null) continue
      const parentId = idBySlug.get(r.file.parent)
      if (parentId == null) {
        log.warn({ slug: r.slug, parent: r.file.parent }, 'parent missing; rendering at root')
        continue
      }
      db.update(s.folders).set({ parentId })
        .where(eq(s.folders.id, idBySlug.get(r.slug)!)).run()
    }
    for (const r of records) {
      const folderId = idBySlug.get(r.slug)!
      const docIds = new Set<number>()
      for (const ref of r.file.members) {
        const id = resolveRef(db, ref)
        if (id != null) docIds.add(id)
      }
      for (const documentId of docIds) {
        db.insert(s.folderMembers).values({ folderId, documentId }).run()
      }
    }
  })
}

/** Slug set → mirror folder ids, optionally expanded to all descendants
 *  (spec §6 includeSubfolders). Exported for the query layer. */
export function folderIdsForSlugs(db: Db, slugs: string[], includeSubfolders: boolean): number[] {
  const all = db.select().from(s.folders).all()
  const bySlug = new Map(all.map((f) => [f.slug, f]))
  const childrenOf = new Map<number, number[]>()
  for (const f of all) {
    if (f.parentId != null) {
      const list = childrenOf.get(f.parentId) ?? []
      list.push(f.id)
      childrenOf.set(f.parentId, list)
    }
  }
  const out = new Set<number>()
  const queue: number[] = slugs.flatMap((slug) => {
    const f = bySlug.get(slug)
    return f ? [f.id] : []
  })
  for (const id of queue) out.add(id)
  if (includeSubfolders) {
    while (queue.length > 0) {
      const id = queue.pop()!
      for (const child of childrenOf.get(id) ?? []) {
        if (!out.has(child)) {
          out.add(child)
          queue.push(child)
        }
      }
    }
  }
  return [...out]
}

/** documentIds → durable member refs (spec §5): hash-first; unhashed docs get
 *  a path ref from their first instance; ids with neither are skipped. The
 *  renderer never constructs refs — this is the only place ids become refs. */
export function refsForDocumentIds(db: Db, documentIds: number[]): FolderMemberRef[] {
  const out: FolderMemberRef[] = []
  for (const id of documentIds) {
    const doc = db.select().from(s.documents).where(eq(s.documents.id, id)).get()
    if (!doc) continue
    if (doc.contentSha256) {
      out.push({ sha256: doc.contentSha256 })
      continue
    }
    const inst = db
      .select({
        externalKey: s.documentInstances.externalKey,
        stableKey: s.libraries.stableKey,
        connectorKey: s.connectors.key,
      })
      .from(s.documentInstances)
      .innerJoin(s.libraries, eq(s.documentInstances.libraryId, s.libraries.id))
      .innerJoin(s.connectors, eq(s.libraries.connectorId, s.connectors.id))
      .where(eq(s.documentInstances.documentId, id))
      .get()
    if (inst) out.push({ library: `${inst.connectorKey}:${inst.stableKey}`, key: inst.externalKey })
  }
  return out
}
