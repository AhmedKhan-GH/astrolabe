import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { openDb, type DbHandle } from '../db'
import * as s from '../db/schema'
import { createUpsertApi, type UpsertApi } from './upsert'
import { refsForDocumentIds } from './folder-mirror'
import { createFoldersStore, type FoldersStore } from '../lib/folders'
import type { RenameFolderResult } from '../../shared/db-ipc'

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

  it('unhashed multi-instance doc: FIRST instance = lowest instance id, stable across calls', () => {
    const z = upsert.ensureLibrary('zotero', '1', 'My Library')
    const v = upsert.ensureLibrary('obsidian', '/vault', 'Vault')
    // Merge two instances into one document via a shared hash, then null the
    // hash — the only wire to a multi-instance unhashed document (spec §5's
    // "first instance" case must be deterministic, not SQLite row order).
    const first = upsert.upsertDocument({
      libraryId: z.id, externalKey: 'K-first', uri: 'z://', title: 'D', kind: 'pdf',
      contentSha256: 'h-merge', modifiedAt: 1,
    })
    const second = upsert.upsertDocument({
      libraryId: v.id, externalKey: 'later.md', uri: 'o://', title: 'D', kind: 'pdf',
      contentSha256: 'h-merge', modifiedAt: 2,
    })
    expect(second.documentId).toBe(first.documentId)
    expect(second.instanceId).toBeGreaterThan(first.instanceId)
    handle.db.update(s.documents).set({ contentSha256: null })
      .where(eq(s.documents.id, first.documentId)).run()

    const expected = [{ library: 'zotero:1', key: 'K-first' }]
    expect(refsForDocumentIds(handle.db, [first.documentId])).toEqual(expected)
    expect(refsForDocumentIds(handle.db, [first.documentId])).toEqual(expected)
  })
})

describe('folders:rename response shape (spec §5: "the response carries the new slug")', () => {
  let dir: string
  let store: FoldersStore
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'astrolabe-frename-'))
    store = createFoldersStore(dir)
  })
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('store.rename yields {record.slug, previousSlug} — exactly what the handler forwards as {slug, previousSlug}', () => {
    store.create({ name: 'Old Name' })
    const { record, previousSlug } = store.rename('old-name', 'New Name')
    // Mirrors the FOLDERS_RENAME_CHANNEL handler's composition in index.ts:
    // { tree: queries.folderTree(), slug: record.slug, previousSlug }.
    const result: RenameFolderResult<unknown> = { tree: [], slug: record.slug, previousSlug }
    expect(result.slug).toBe('new-name')
    expect(result.previousSlug).toBe('old-name')
    expect(result.slug).not.toBe(result.previousSlug)
  })
})
