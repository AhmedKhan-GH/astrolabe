import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { openDb, type DbHandle } from '../db'
import { createUpsertApi, type UpsertApi } from './upsert'
import { createFoldersStore, type FoldersStore } from '../lib/folders'
import { reconcileRemovals } from './removals'
import { syncFolders } from './folder-mirror'
import * as s from '../db/schema'

/** Tier A integration: files → mirror (spec §4). Wholesale rebuild, ref
 *  resolution (hash / path / unresolved), idempotency, wipe survival. */
let dir: string
let handle: DbHandle
let upsert: UpsertApi
let store: FoldersStore

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'astrolabe-fmirror-'))
  handle = openDb(join(dir, 'index.db'))
  upsert = createUpsertApi(handle.db)
})
afterAll(() => {
  handle.close()
  rmSync(dir, { recursive: true, force: true })
})
beforeEach(() => {
  upsert.wipeDerived()
  rmSync(join(dir, 'folders'), { recursive: true, force: true })
  store = createFoldersStore(join(dir, 'folders'))
})

const seedDocs = (): { pdfId: number; noteId: number; vaultKey: string } => {
  const z = upsert.ensureLibrary('zotero', '1', 'My Library')
  const v = upsert.ensureLibrary('obsidian', '/vault', 'Vault')
  const pdf = upsert.upsertDocument({
    libraryId: z.id, externalKey: 'K1', uri: 'zotero://x', title: 'Paper',
    kind: 'pdf', contentSha256: 'hash-p', modifiedAt: 1,
  })
  const note = upsert.upsertDocument({
    libraryId: v.id, externalKey: 'n.md', uri: 'obsidian://x', title: 'n',
    kind: 'note', contentSha256: null, modifiedAt: 1,
  })
  return { pdfId: pdf.documentId, noteId: note.documentId, vaultKey: 'obsidian:/vault' }
}

const memberDocIds = (slug: string): number[] => {
  const row = handle.db.select().from(s.folders).where(eq(s.folders.slug, slug)).get()
  if (!row) return []
  return handle.db
    .select({ d: s.folderMembers.documentId })
    .from(s.folderMembers)
    .where(eq(s.folderMembers.folderId, row.id))
    .all()
    .map((r) => r.d)
}

describe('syncFolders', () => {
  it('resolves hash refs and path refs; unresolved refs contribute nothing yet', () => {
    const { pdfId, noteId, vaultKey } = seedDocs()
    const f = store.create({ name: 'Course' })
    store.addMembers(f.slug, [
      { sha256: 'hash-p' },
      { library: vaultKey, key: 'n.md' },
      { sha256: 'hash-not-yet-synced' },
    ])
    syncFolders(handle.db, store)
    expect(memberDocIds('course').sort()).toEqual([pdfId, noteId].sort())
    // the unresolved ref stays in the FILE untouched (spec §3: never pruned)
    expect(store.list()[0]?.file.members).toHaveLength(3)
  })

  it('unresolved ref resolves after the document arrives + re-mirror', () => {
    seedDocs()
    const f = store.create({ name: 'Course' })
    store.addMembers(f.slug, [{ sha256: 'hash-late' }])
    syncFolders(handle.db, store)
    expect(memberDocIds('course')).toHaveLength(0)
    const z = upsert.ensureLibrary('zotero', '1', 'My Library')
    upsert.upsertDocument({
      libraryId: z.id, externalKey: 'K9', uri: 'zotero://y', title: 'Late',
      kind: 'pdf', contentSha256: 'hash-late', modifiedAt: 2,
    })
    syncFolders(handle.db, store)
    expect(memberDocIds('course')).toHaveLength(1)
  })

  it('is a wholesale rebuild: deleted folders/members vanish; idempotent; parent linked', () => {
    seedDocs()
    const root = store.create({ name: 'Root' })
    const child = store.create({ name: 'Child', parent: root.slug })
    store.addMembers(child.slug, [{ sha256: 'hash-p' }])
    syncFolders(handle.db, store)
    syncFolders(handle.db, store) // idempotent
    const rows = handle.db.select().from(s.folders).all()
    expect(rows).toHaveLength(2)
    const childRow = rows.find((r) => r.slug === 'child')
    const rootRow = rows.find((r) => r.slug === 'root')
    expect(childRow?.parentId).toBe(rootRow?.id)
    store.remove(child.slug)
    syncFolders(handle.db, store)
    expect(handle.db.select().from(s.folders).all()).toHaveLength(1)
    expect(handle.db.select().from(s.folderMembers).all()).toHaveLength(0)
  })

  it('membership survives wipeDerived + rescan + re-mirror (ids renumbered)', () => {
    const { vaultKey } = seedDocs()
    void vaultKey
    const f = store.create({ name: 'Keep' })
    store.addMembers(f.slug, [{ sha256: 'hash-p' }])
    syncFolders(handle.db, store)
    upsert.wipeDerived()
    seedDocs() // rescan re-creates the documents with NEW ids
    syncFolders(handle.db, store)
    expect(memberDocIds('keep')).toHaveLength(1)
  })

  it('ghost members stay mirrored (membership is not presence, spec §3)', () => {
    seedDocs()
    const f = store.create({ name: 'G' })
    store.addMembers(f.slug, [{ sha256: 'hash-p' }])
    // kill the only instance → ghost
    const z = upsert.ensureLibrary('zotero', '1', 'My Library')
    reconcileRemovals(handle.db, z.id, [])
    syncFolders(handle.db, store)
    expect(memberDocIds('g')).toHaveLength(1)
  })
})
