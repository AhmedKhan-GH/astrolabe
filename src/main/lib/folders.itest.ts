import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createFoldersStore, FolderError, type FoldersStore } from './folders'

/** Tier A integration: the folder store against a real tmp dir (spec §2–3). */
let dir: string
let store: FoldersStore
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'astrolabe-folders-'))
  store = createFoldersStore(dir)
})
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('folder store round-trips', () => {
  it('create → nest → file on disk matches schema; duplicate name rejected', () => {
    const root = store.create({ name: 'EEC 174 ABY' })
    store.create({ name: 'Lectures', parent: root.slug })
    const onDisk = JSON.parse(readFileSync(join(dir, 'lectures.json'), 'utf-8'))
    expect(onDisk.parent).toBe('eec-174-aby')
    expect(() => store.create({ name: 'Lectures' })).toThrow(FolderError)
  })

  it('cycle rejected at write time; BAD_PARENT for missing parent', () => {
    const a = store.create({ name: 'A' })
    const b = store.create({ name: 'B', parent: a.slug })
    expect(() => store.setParent(a.slug, b.slug)).toThrow(/cycle/i)
    expect(() => store.create({ name: 'C', parent: 'nope' })).toThrow(/parent/i)
  })

  it('addMembers dedupes; removeMembers touches only named refs', () => {
    const f = store.create({ name: 'F' })
    store.addMembers(f.slug, [{ sha256: 'aa' }, { library: 'obsidian:/v', key: 'n.md' }])
    const after = store.addMembers(f.slug, [{ sha256: 'aa' }])
    expect(after.file.members).toHaveLength(2)
    const removed = store.removeMembers(f.slug, [{ sha256: 'aa' }])
    expect(removed.file.members).toEqual([{ library: 'obsidian:/v', key: 'n.md' }])
  })

  it('remove re-parents children to the removed folder parent', () => {
    const root = store.create({ name: 'Root' })
    const mid = store.create({ name: 'Mid', parent: root.slug })
    store.create({ name: 'Leaf', parent: mid.slug })
    store.remove(mid.slug)
    const leaf = store.list().find((r) => r.slug === 'leaf')
    expect(leaf?.file.parent).toBe('root')
  })

  it('rename regenerates slug, rewrites child parents, drops old file', () => {
    const root = store.create({ name: 'Old Name' })
    store.create({ name: 'Child', parent: root.slug })
    const { record } = store.rename(root.slug, 'New Name')
    expect(record.slug).toBe('new-name')
    expect(readdirSync(dir)).not.toContain('old-name.json')
    expect(store.list().find((r) => r.slug === 'child')?.file.parent).toBe('new-name')
  })

  it('a corrupt file is ignored with the rest intact (hand-edit tolerance)', () => {
    store.create({ name: 'Good' })
    writeFileSync(join(dir, 'bad.json'), '{nope')
    expect(store.list().map((r) => r.slug)).toEqual(['good'])
  })

  it('create with a name over the schema limit throws FolderError, not a silent bad file', () => {
    const tooLong = 'x'.repeat(200)
    expect(() => store.create({ name: tooLong })).toThrow(FolderError)
    expect(readdirSync(dir).filter((f) => f.endsWith('.json'))).toHaveLength(0)
  })

  it('rename to a name over the schema limit throws FolderError, leaves the original file intact', () => {
    const f = store.create({ name: 'Fine' })
    const tooLong = 'y'.repeat(200)
    expect(() => store.rename(f.slug, tooLong)).toThrow(FolderError)
    expect(store.list().map((r) => r.slug)).toEqual(['fine'])
  })
})

describe('renamePathRefs — rename healing (folders spec §3)', () => {
  const lib = 'obsidian:/vault'

  it('rewrites the matching path ref across every folder file, preserving order', () => {
    const a = store.create({ name: 'A' })
    const b = store.create({ name: 'B' })
    store.addMembers(a.slug, [{ library: lib, key: 'old.md' }, { sha256: 'keep' }])
    store.addMembers(b.slug, [{ library: lib, key: 'old.md' }])

    const n = store.renamePathRefs(lib, 'old.md', 'new.md')

    expect(n).toBe(2)
    expect(store.list().find((r) => r.slug === 'a')?.file.members).toEqual([
      { library: lib, key: 'new.md' },
      { sha256: 'keep' },
    ])
    expect(store.list().find((r) => r.slug === 'b')?.file.members).toEqual([{ library: lib, key: 'new.md' }])
  })

  it('drops the old ref instead of duplicating when the target ref already exists', () => {
    const f = store.create({ name: 'F' })
    store.addMembers(f.slug, [{ library: lib, key: 'old.md' }, { library: lib, key: 'new.md' }])

    const n = store.renamePathRefs(lib, 'old.md', 'new.md')

    expect(n).toBe(1)
    expect(store.list().find((r) => r.slug === 'f')?.file.members).toEqual([{ library: lib, key: 'new.md' }])
  })

  it('touches nothing else — hash refs, other libraries, other keys are left intact', () => {
    const f = store.create({ name: 'F' })
    const other = 'obsidian:/other'
    const members = [{ sha256: 'h' }, { library: other, key: 'old.md' }, { library: lib, key: 'stay.md' }]
    store.addMembers(f.slug, members)

    const n = store.renamePathRefs(lib, 'old.md', 'new.md') // no ref matches (lib,old.md)

    expect(n).toBe(0)
    expect(store.list().find((r) => r.slug === 'f')?.file.members).toEqual(members)
  })
})
