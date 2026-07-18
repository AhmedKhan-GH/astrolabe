import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, type DbHandle } from '../db'
import { createUpsertApi, type UpsertApi } from './upsert'
import { createFoldersStore, type FoldersStore } from '../lib/folders'
import { importLibraryTree } from './folder-import'

/** Tier A: D-A6 — lift an already-synced source tree into Astrolabe folders
 *  under a fresh root; a copy, never a sync; re-run isolation. */
let dir: string
let handle: DbHandle
let upsert: UpsertApi
let store: FoldersStore
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'astrolabe-fimport-'))
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

/** Seed an eagle-like library: folders root→sub, one hashed member in each,
 *  plus one unhashed+instanceless member (unreferenceable → skipped). */
function seedEagle(): { libraryId: number } {
  const e = upsert.ensureLibrary('eagle', '/Books.library', 'Books')
  upsert.upsertCollections(e.id, [
    { externalKey: 'root-f', name: 'Reading' },
    { externalKey: 'sub-f', name: 'Finished', parentExternalKey: 'root-f' },
  ])
  upsert.upsertDocument({
    libraryId: e.id, externalKey: 'I1', uri: 'eagle://item/I1', title: 'Book One',
    kind: 'pdf', contentSha256: 'h-one', modifiedAt: 1, collectionKeys: ['root-f'],
  })
  upsert.upsertDocument({
    libraryId: e.id, externalKey: 'I2', uri: 'eagle://item/I2', title: 'Book Two',
    kind: 'pdf', contentSha256: 'h-two', modifiedAt: 1, collectionKeys: ['sub-f'],
  })
  return { libraryId: e.id }
}

describe('importLibraryTree', () => {
  it('lifts the tree under a fresh root: names, nesting, hash-first members', () => {
    const { libraryId } = seedEagle()
    const result = importLibraryTree(handle.db, store, { libraryId })
    expect(result).toEqual({ created: 3, members: 2, skipped: 0 }) // root + 2 folders
    const records = store.list()
    const root = records.find((r) => r.file.parent === null)
    expect(root?.file.name).toBe('Books (imported)')
    const reading = records.find((r) => r.file.name === 'Reading')
    const finished = records.find((r) => r.file.name === 'Finished')
    expect(reading?.file.parent).toBe(root?.slug)
    expect(finished?.file.parent).toBe(reading?.slug)
    expect(reading?.file.members).toEqual([{ sha256: 'h-one' }])
    expect(finished?.file.members).toEqual([{ sha256: 'h-two' }])
  })

  it('re-run lands in a second fresh root — never merges into curated folders', () => {
    const { libraryId } = seedEagle()
    importLibraryTree(handle.db, store, { libraryId })
    const second = importLibraryTree(handle.db, store, { libraryId })
    expect(second.created).toBe(3)
    const roots = store.list().filter((r) => r.file.parent === null)
    expect(roots).toHaveLength(2) // "Books (imported)" + "Books (imported) 2"
  })

  it('slug-equal names collide even when display names differ — suffixed, never thrown', () => {
    // "Notes" and "notes!" slugify identically; the store's DUPLICATE guard is
    // on SLUGS, so a display-name-only check would let create() throw mid-import
    // and strand a partial root (spec §6b re-run isolation).
    store.create({ name: 'Notes' })
    const e = upsert.ensureLibrary('eagle', '/Books.library', 'Books')
    upsert.upsertCollections(e.id, [{ externalKey: 'c', name: 'notes!' }])
    const result = importLibraryTree(handle.db, store, { libraryId: e.id })
    expect(result).toEqual({ created: 2, members: 0, skipped: 0 }) // root + 1 folder
    const records = store.list()
    const curated = records.find((r) => r.file.name === 'Notes')
    expect(curated?.file.parent).toBeNull()
    expect(curated?.file.members).toEqual([])
    const imported = records.find((r) => r.file.name === 'notes! 2')
    expect(imported).toBeDefined()
    const root = records.find((r) => r.file.name === 'Books (imported)')
    expect(imported?.file.parent).toBe(root?.slug)
  })

  it('unhashed member with an instance becomes a path ref; instanceless is skipped+counted', () => {
    const e = upsert.ensureLibrary('eagle', '/Books.library', 'Books')
    upsert.upsertCollections(e.id, [{ externalKey: 'f', name: 'Notes-ish' }])
    upsert.upsertDocument({
      libraryId: e.id, externalKey: 'I3', uri: 'eagle://item/I3', title: 'No hash yet',
      kind: 'other', contentSha256: null, modifiedAt: 1, collectionKeys: ['f'],
    })
    const result = importLibraryTree(handle.db, store, { libraryId: e.id, rootName: 'Seed' })
    expect(result.members).toBe(1)
    const f = store.list().find((r) => r.file.name === 'Notes-ish')
    expect(f?.file.members).toEqual([{ library: 'eagle:/Books.library', key: 'I3' }])
  })
})
