import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, type DbHandle } from '../db'
import { createUpsertApi, type UpsertApi } from './upsert'
import { refsForDocumentIds } from './folder-mirror'

/** Tier A: the main-side id→ref policy (spec §5): hash-first, path ref for
 *  unhashed notes, skip the unreferenceable. The renderer never builds refs. */
let dir: string
let handle: DbHandle
let upsert: UpsertApi
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'astrolabe-fipc-'))
  handle = openDb(join(dir, 'index.db'))
  upsert = createUpsertApi(handle.db)
})
afterAll(() => {
  handle.close()
  rmSync(dir, { recursive: true, force: true })
})
beforeEach(() => upsert.wipeDerived())

describe('refsForDocumentIds', () => {
  it('hash ref for hashed docs; path ref for notes; skips id without either', () => {
    const z = upsert.ensureLibrary('zotero', '1', 'My Library')
    const v = upsert.ensureLibrary('obsidian', '/vault', 'Vault')
    const pdf = upsert.upsertDocument({
      libraryId: z.id, externalKey: 'K1', uri: 'z://', title: 'P', kind: 'pdf',
      contentSha256: 'h-p', modifiedAt: 1,
    })
    const note = upsert.upsertDocument({
      libraryId: v.id, externalKey: 'n.md', uri: 'o://', title: 'n', kind: 'note',
      contentSha256: null, modifiedAt: 1,
    })
    const refs = refsForDocumentIds(handle.db, [pdf.documentId, note.documentId, 999_999])
    expect(refs).toEqual([
      { sha256: 'h-p' },
      { library: 'obsidian:/vault', key: 'n.md' },
    ])
  })
})
