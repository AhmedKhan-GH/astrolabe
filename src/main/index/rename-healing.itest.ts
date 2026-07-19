import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { openDb, type DbHandle } from '../db'
import * as s from '../db/schema'
import { createUpsertApi, type UpsertApi } from './upsert'
import { syncConnector } from './sync'
import { refsForDocumentIds, syncFolders } from './folder-mirror'
import { createFoldersStore, type FoldersStore } from '../lib/folders'
import { createObsidianConnector } from '../connectors/obsidian'

/**
 * Tier A end-to-end (identity hardening 1 §3): a filed note survives a rename.
 * A real vault + real sqlite + the real sync runner heal the rename, and the
 * onInstanceRenamed → renamePathRefs wiring keeps the folder membership pointing
 * at the SAME document through the mirror re-pass — zero user discipline.
 */

let dir: string
let handle: DbHandle
let upsert: UpsertApi
let store: FoldersStore

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'astrolabe-heal-'))
  handle = openDb(join(dir, 'index.db'))
  upsert = createUpsertApi(handle.db)
  store = createFoldersStore(join(dir, 'folders'))
})
afterEach(() => {
  handle.close()
  rmSync(dir, { recursive: true, force: true })
})

function instByKey(key: string): s.DocumentInstance | undefined {
  return handle.db
    .select()
    .from(s.documentInstances)
    .where(eq(s.documentInstances.externalKey, key))
    .get()
}

function memberDocIds(slug: string): number[] {
  const folder = handle.db.select().from(s.folders).where(eq(s.folders.slug, slug)).get()
  if (!folder) return []
  return handle.db
    .select({ d: s.folderMembers.documentId })
    .from(s.folderMembers)
    .where(eq(s.folderMembers.folderId, folder.id))
    .all()
    .map((r) => r.d)
}

describe('rename healing — filed note survives a rename end-to-end', () => {
  it('rename → sync heal → path-ref rewrite → membership intact in the mirror', async () => {
    const vaultPath = join(dir, 'Vault')
    mkdirSync(vaultPath, { recursive: true })
    writeFileSync(join(vaultPath, 'a.md'), 'content that fingerprints the note\n')

    const conn = createObsidianConnector({ vaultPaths: [vaultPath] })

    // Index the note, then file it into a folder (a path ref to a.md).
    await syncConnector(handle.db, upsert, conn)
    const docId = instByKey('a.md')!.documentId
    const folder = store.create({ name: 'Filed' })
    store.addMembers(folder.slug, refsForDocumentIds(handle.db, [docId]))
    syncFolders(handle.db, store)
    expect(memberDocIds(folder.slug)).toContain(docId)

    // Rename a.md → c.md (same bytes → same hint), then re-sync WITH the heal
    // wiring the composition root uses: onInstanceRenamed → renamePathRefs.
    writeFileSync(join(vaultPath, 'c.md'), 'content that fingerprints the note\n')
    rmSync(join(vaultPath, 'a.md'))
    await syncConnector(handle.db, upsert, conn, Date.now(), {
      onInstanceRenamed: (ev) => store.renamePathRefs(ev.library, ev.oldKey, ev.newKey),
    })
    syncFolders(handle.db, store)

    // The instance moved to c.md but kept its document; the ref was rewritten,
    // so the folder still holds the SAME document — membership intact, no ghost.
    const healed = instByKey('c.md')!
    expect(healed.documentId).toBe(docId)
    expect(instByKey('a.md')).toBeUndefined()
    expect(memberDocIds(folder.slug)).toContain(docId)
    expect(store.list().find((r) => r.slug === folder.slug)?.file.members).toEqual([
      { library: `obsidian:${vaultPath}`, key: 'c.md' },
    ])
  })
})
