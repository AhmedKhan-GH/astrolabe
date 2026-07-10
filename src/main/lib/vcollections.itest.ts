import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { openDb, type DbHandle } from '../db'
import * as s from '../db/schema'
import { createUpsertApi, type UpsertApi } from '../index/upsert'
import {
  createVCollectionsApi,
  syncVirtualCollections,
  virtualCollectionFileSchema,
  type VCollectionsApi,
} from './vcollections'

/**
 * Tier A integration for virtual collections (docs/2026-07-10-lens-virtual-collections-spec
 * §Testing): the file is the contract, the mirror is derived — so this exercises real fs against
 * a tmp dir AND real SQLite + migrations. Covers file CRUD + upsert, ref resolution via hash and
 * via instance fallback, unresolved-retained-but-excluded, re-mirror after mutation, and the
 * simulated-rebuild survival via content hash.
 */
let dir: string
let handle: DbHandle
let upsert: UpsertApi
let api: VCollectionsApi

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'astrolabe-vc-'))
  handle = openDb(join(dir, 'index.db'))
  upsert = createUpsertApi(handle.db)
})
afterAll(() => {
  handle.close()
  rmSync(dir, { recursive: true, force: true })
})

// A fresh files dir per test (so slugs never collide across cases) plus a re-seeded index.
let filesDir: string
const docId = (sourceKey: string, externalKey: string): number => {
  const src = handle.db.select().from(s.sources).where(eq(s.sources.key, sourceKey)).get()!
  return handle.db
    .select()
    .from(s.documentInstances)
    .where(eq(s.documentInstances.externalKey, externalKey))
    .all()
    .find((i) => i.sourceId === src.id)!.documentId
}
const memberDocIds = (slug: string): number[] => {
  const vc = handle.db.select().from(s.virtualCollections).where(eq(s.virtualCollections.slug, slug)).get()
  if (!vc) return []
  return handle.db
    .select({ documentId: s.virtualCollectionMembers.documentId })
    .from(s.virtualCollectionMembers)
    .where(eq(s.virtualCollectionMembers.vcId, vc.id))
    .all()
    .map((r) => r.documentId)
    .sort((a, b) => a - b)
}

beforeEach(() => {
  upsert.wipeDerived()
  // Zotero PDF (hashed) — also present in Eagle (same hash → one document, two instances).
  upsert.upsertDocument({ sourceKey: 'zotero', externalKey: 'Z1', uri: 'zotero://Z1', title: 'Alpha', kind: 'pdf', contentSha256: 'a'.repeat(64), modifiedAt: 100 })
  upsert.upsertDocument({ sourceKey: 'eagle', externalKey: 'E1', uri: 'eagle://E1', title: 'Alpha', kind: 'pdf', contentSha256: 'a'.repeat(64), modifiedAt: 100 })
  // An obsidian note with NO content hash — only an instance ref can address it.
  upsert.upsertDocument({ sourceKey: 'obsidian', externalKey: 'notes/beta.md', uri: 'obsidian://beta', title: 'Beta', kind: 'note', modifiedAt: 200 })
  // A second hashed doc.
  upsert.upsertDocument({ sourceKey: 'zotero', externalKey: 'Z2', uri: 'zotero://Z2', title: 'Gamma', kind: 'pdf', contentSha256: 'c'.repeat(64), modifiedAt: 300 })
  filesDir = mkdtempSync(join(dir, 'files-'))
  api = createVCollectionsApi(filesDir, handle.db)
  syncVirtualCollections(handle.db, filesDir)
})

describe('file CRUD + upsert', () => {
  it('create writes a schema-valid file and lists it (empty membership)', () => {
    const created = api.create({ name: 'Reading List' })
    expect(created).toEqual({ slug: 'reading-list', name: 'Reading List', count: 0, unresolvedCount: 0 })
    expect(existsSync(join(filesDir, 'reading-list.json'))).toBe(true)
    const onDisk = virtualCollectionFileSchema.parse(JSON.parse(readFileSync(join(filesDir, 'reading-list.json'), 'utf-8')))
    expect(onDisk).toMatchObject({ schemaVersion: 1, name: 'Reading List', members: [] })
    expect(api.list()).toEqual([{ slug: 'reading-list', name: 'Reading List', count: 0, unresolvedCount: 0 }])
  })

  it('list is name-sorted and skips a corrupt file', () => {
    api.create({ name: 'Zebra' })
    api.create({ name: 'Alpha' })
    writeFileSync(join(filesDir, 'broken.json'), '{ not json')
    expect(api.list().map((v) => v.name)).toEqual(['Alpha', 'Zebra'])
  })

  it('create upserts by slug NON-destructively — membership survives a same-name create', () => {
    api.create({ name: 'Keep' })
    api.addMembers({ slug: 'keep', documentIds: [docId('obsidian', 'notes/beta.md')] })
    const again = api.create({ name: 'Keep' })
    expect(again.count).toBe(1)
    expect(memberDocIds('keep')).toEqual([docId('obsidian', 'notes/beta.md')])
  })

  it('delete removes the file, re-mirrors, and reports prior existence', () => {
    api.create({ name: 'Temp' })
    expect(api.remove({ slug: 'temp' })).toBe(true)
    expect(existsSync(join(filesDir, 'temp.json'))).toBe(false)
    expect(handle.db.select().from(s.virtualCollections).all()).toHaveLength(0)
    expect(api.remove({ slug: 'temp' })).toBe(false)
  })
})

describe('mirror resolution', () => {
  it('resolves a hash ref to the merged document (shared by zotero + eagle)', () => {
    api.create({ name: 'Hashed' })
    const summary = api.addMembers({ slug: 'hashed', documentIds: [docId('zotero', 'Z1')] })
    expect(summary).toEqual({ slug: 'hashed', name: 'Hashed', count: 1, unresolvedCount: 0 })
    // Stored as a hash ref, not an instance ref.
    const file = virtualCollectionFileSchema.parse(JSON.parse(readFileSync(join(filesDir, 'hashed.json'), 'utf-8')))
    expect(file.members).toEqual([{ hash: 'a'.repeat(64) }])
    // The mirror carries the single merged document.
    expect(memberDocIds('hashed')).toEqual([docId('zotero', 'Z1')])
    expect(docId('eagle', 'E1')).toBe(docId('zotero', 'Z1')) // same merged doc, sanity
  })

  it('falls back to an instance ref for a hashless document, and mirrors it', () => {
    api.create({ name: 'Notes' })
    api.addMembers({ slug: 'notes', documentIds: [docId('obsidian', 'notes/beta.md')] })
    const file = virtualCollectionFileSchema.parse(JSON.parse(readFileSync(join(filesDir, 'notes.json'), 'utf-8')))
    expect(file.members).toEqual([{ sourceKey: 'obsidian', key: 'notes/beta.md' }])
    expect(memberDocIds('notes')).toEqual([docId('obsidian', 'notes/beta.md')])
  })

  it('retains an unresolvable ref in the file, excludes it from the mirror, and counts it', () => {
    // Hand-write a file with a live ref + a dangling hash ref.
    writeFileSync(
      join(filesDir, 'mixed.json'),
      JSON.stringify({
        schemaVersion: 1,
        name: 'Mixed',
        createdAt: new Date().toISOString(),
        members: [{ hash: 'c'.repeat(64) }, { hash: 'f'.repeat(64) }], // second matches no document
      }),
    )
    syncVirtualCollections(handle.db, filesDir)
    expect(memberDocIds('mixed')).toEqual([docId('zotero', 'Z2')]) // only the resolvable one mirrored
    const summary = api.list().find((v) => v.slug === 'mixed')!
    expect(summary).toEqual({ slug: 'mixed', name: 'Mixed', count: 1, unresolvedCount: 1 })
    // The dangling ref is still on disk (the document may reappear on a later sync).
    const file = virtualCollectionFileSchema.parse(JSON.parse(readFileSync(join(filesDir, 'mixed.json'), 'utf-8')))
    expect(file.members).toContainEqual({ hash: 'f'.repeat(64) })
  })
})

describe('member mutation re-mirrors', () => {
  it('add then remove reflects in the mirror each time; dedupes', () => {
    api.create({ name: 'M' })
    api.addMembers({ slug: 'm', documentIds: [docId('zotero', 'Z1'), docId('zotero', 'Z2')] })
    expect(memberDocIds('m')).toEqual([docId('zotero', 'Z1'), docId('zotero', 'Z2')].sort((a, b) => a - b))
    // Re-adding the same doc (via its eagle twin id) dedupes to one hash ref.
    api.addMembers({ slug: 'm', documentIds: [docId('eagle', 'E1')] })
    const file = virtualCollectionFileSchema.parse(JSON.parse(readFileSync(join(filesDir, 'm.json'), 'utf-8')))
    expect(file.members.filter((r) => 'hash' in r && r.hash === 'a'.repeat(64))).toHaveLength(1)
    // Remove one.
    const after = api.removeMembers({ slug: 'm', documentIds: [docId('zotero', 'Z1')] })
    expect(after.count).toBe(1)
    expect(memberDocIds('m')).toEqual([docId('zotero', 'Z2')])
  })
})

describe('mirror survives a simulated rebuild via content hash', () => {
  it('wipe index tables, re-sync docs, re-mirror → hashed membership restored', () => {
    api.create({ name: 'Survivor' })
    api.addMembers({ slug: 'survivor', documentIds: [docId('zotero', 'Z1')] })
    expect(memberDocIds('survivor')).toHaveLength(1)

    // Simulate a rebuild: wipe everything derived (documents get NEW ids), then re-scan.
    upsert.wipeDerived()
    expect(handle.db.select().from(s.virtualCollectionMembers).all()).toHaveLength(0) // FK-cascaded away
    upsert.upsertDocument({ sourceKey: 'zotero', externalKey: 'Z1', uri: 'zotero://Z1', title: 'Alpha', kind: 'pdf', contentSha256: 'a'.repeat(64), modifiedAt: 100 })

    // Re-mirror from the untouched file → membership restored against the new document id via hash.
    syncVirtualCollections(handle.db, filesDir)
    expect(memberDocIds('survivor')).toEqual([docId('zotero', 'Z1')])
  })
})
