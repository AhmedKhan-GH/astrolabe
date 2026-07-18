import { eq } from 'drizzle-orm'
import type { Db } from '../db'
import * as s from '../db/schema'
import { moduleLogger } from '../lib/logger'
import type { FoldersStore } from '../lib/folders'
import { refsForDocumentIds } from './folder-mirror'
import type { ImportFoldersResult } from '../../shared/db-ipc'

/**
 * D-A6 (folders spec §6b): lift an already-synced library's collection tree
 * into Astrolabe folders under a FRESH root. A copy, not a subscription —
 * after import the trees are unlinked. Re-runnable: each run creates a new
 * root ("<name> (imported)", "<name> (imported) 2", …), never merging into
 * folders curated since. Members become durable refs via the same hash-first
 * policy as filing (refsForDocumentIds); items that yield no ref are skipped
 * and counted.
 */
const log = moduleLogger('folder-import')

export function importLibraryTree(
  db: Db,
  store: FoldersStore,
  req: { libraryId: number; rootName?: string },
): ImportFoldersResult {
  const library = db.select().from(s.libraries).where(eq(s.libraries.id, req.libraryId)).get()
  if (!library) throw new Error(`no such library: ${req.libraryId}`)

  // Fresh root: first free of "<base>", "<base> 2", "<base> 3", …
  const base = req.rootName ?? `${library.displayName} (imported)`
  const taken = new Set(store.list().map((r) => r.file.name))
  let rootName = base
  for (let n = 2; taken.has(rootName); n++) rootName = `${base} ${n}`
  const root = store.create({ name: rootName })
  let created = 1
  let members = 0
  let skipped = 0

  const collections = db
    .select()
    .from(s.collections)
    .where(eq(s.collections.libraryId, req.libraryId))
    .all()
  // Two passes (upsertCollections precedent): create all, then parent them —
  // source order is arbitrary. Names collide across the source tree? The
  // store's DUPLICATE guard would fire — suffix like the root.
  const slugByCollectionId = new Map<number, string>()
  for (const c of collections) {
    let name = c.name
    for (let n = 2; store.list().some((r) => r.file.name === name); n++) name = `${c.name} ${n}`
    const rec = store.create({ name, parent: root.slug })
    slugByCollectionId.set(c.id, rec.slug)
    created++
  }
  for (const c of collections) {
    if (c.parentId == null) continue
    const child = slugByCollectionId.get(c.id)
    const parent = slugByCollectionId.get(c.parentId)
    if (child && parent) store.setParent(child, parent)
  }

  for (const c of collections) {
    const slug = slugByCollectionId.get(c.id)
    if (!slug) continue
    const docIds = db
      .select({ documentId: s.documentCollections.documentId })
      .from(s.documentCollections)
      .where(eq(s.documentCollections.collectionId, c.id))
      .all()
      .map((r) => r.documentId)
    if (docIds.length === 0) continue
    const refs = refsForDocumentIds(db, docIds)
    skipped += docIds.length - refs.length
    members += refs.length
    if (refs.length > 0) store.addMembers(slug, refs)
  }

  log.info({ library: library.displayName, created, members, skipped }, 'source tree lifted into folders')
  return { created, members, skipped }
}
