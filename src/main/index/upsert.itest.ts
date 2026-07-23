import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { openDb, type DbHandle } from '../db'
import { createUpsertApi, type UpsertApi } from './upsert'
import * as s from '../db/schema'

/**
 * Tier A integration: the v2 index write path against real SQLite + real
 * migrations. Library-scoped identity (spine spec v2 §1), the cross-library
 * hash join, idempotency, tags M:N, annotation upsert, wipe, and the ghost
 * rule (spec §2: pruning a connector never deletes documents). FTS assertions
 * live with queries (commit 9) — here we read the tables directly.
 */
let dir: string
let handle: DbHandle
let upsert: UpsertApi

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'astrolabe-upsert-'))
  handle = openDb(join(dir, 'index.db'))
  upsert = createUpsertApi(handle.db)
})
afterAll(() => {
  handle.close()
  rmSync(dir, { recursive: true, force: true })
})
beforeEach(() => upsert.wipeDerived())

const lib = (connector: string, stableKey: string) =>
  upsert.ensureLibrary(connector, stableKey, `${connector}:${stableKey}`)

const doc = (libraryId: number, over: Record<string, unknown> = {}) => ({
  libraryId,
  externalKey: 'ABC123',
  uri: 'zotero://select/library/items/ABC123',
  title: 'Probabilistic Machine Learning',
  kind: 'pdf' as const,
  contentSha256: 'hash-murphy',
  modifiedAt: 1000,
  tags: ['ml', 'textbook'],
  annotations: [
    {
      externalKey: 'ANN1',
      type: 'highlight',
      text: 'precision and recall tradeoff',
      pageLabel: '148',
      modifiedAt: 1000,
    },
  ],
  ...over,
})

const allDocuments = () => handle.db.select().from(s.documents).all()
const instancesOf = (documentId: number) =>
  handle.db
    .select()
    .from(s.documentInstances)
    .where(eq(s.documentInstances.documentId, documentId))
    .all()

describe('ensureLibrary', () => {
  it('creates connector + library once; same (connector, stableKey) → same row', () => {
    const a = lib('zotero', '1')
    const b = lib('zotero', '1')
    expect(b.id).toBe(a.id)
    const g = lib('zotero', 'group:4415')
    expect(g.id).not.toBe(a.id)
    expect(handle.db.select().from(s.connectors).all()).toHaveLength(1)
    expect(handle.db.select().from(s.libraries).all()).toHaveLength(2)
  })
})

describe('upsertDocument — library-scoped identity', () => {
  it('is idempotent: same payload twice → one document, one instance, one annotation', () => {
    const z = lib('zotero', '1')
    const first = upsert.upsertDocument(doc(z.id))
    const second = upsert.upsertDocument(doc(z.id))
    expect(second.documentId).toBe(first.documentId)
    expect(second.instanceId).toBe(first.instanceId)
    expect(allDocuments()).toHaveLength(1)
    expect(instancesOf(first.documentId)).toHaveLength(1)
    expect(handle.db.select().from(s.annotations).all()).toHaveLength(1)
  })

  it('HASH JOIN across connectors: same contentSha256 → one document, two instances', () => {
    const z = lib('zotero', '1')
    const e = lib('eagle', '/Users/x/Pictures.library')
    const a = upsert.upsertDocument(doc(z.id))
    const b = upsert.upsertDocument(
      doc(e.id, {
        externalKey: 'MQG0GMKZ',
        uri: 'eagle://item/MQG0GMKZ',
        title: 'Murphy ProbabilisticMachineLearning',
        annotations: undefined,
        tags: ['reference'],
      }),
    )
    expect(b.documentId).toBe(a.documentId)
    expect(instancesOf(a.documentId)).toHaveLength(2)
    // tags from both copies merge on the one document
    const tagNames = handle.db
      .select({ name: s.tags.name })
      .from(s.tags)
      .innerJoin(s.documentTags, eq(s.documentTags.tagId, s.tags.id))
      .where(eq(s.documentTags.documentId, a.documentId))
      .all()
      .map((r) => r.name)
      .sort()
    expect(tagNames).toEqual(['ml', 'reference', 'textbook'])
  })

  it('HASH JOIN across two libraries of ONE connector (personal + group) → one document', () => {
    const personal = lib('zotero', '1')
    const group = lib('zotero', 'group:4415')
    const a = upsert.upsertDocument(doc(personal.id))
    const b = upsert.upsertDocument(
      doc(group.id, { externalKey: 'GRP999', uri: 'zotero://select/groups/4415/items/GRP999' }),
    )
    expect(b.documentId).toBe(a.documentId)
    expect(instancesOf(a.documentId)).toHaveLength(2)
  })

  it('same externalKey in two libraries of one connector → DISTINCT instances (v2 scoping)', () => {
    const personal = lib('zotero', '1')
    const group = lib('zotero', 'group:4415')
    // Same item key, different corpora, no hash: must not collide (v1 would have).
    const a = upsert.upsertDocument(doc(personal.id, { contentSha256: null }))
    const b = upsert.upsertDocument(doc(group.id, { contentSha256: null }))
    expect(b.instanceId).not.toBe(a.instanceId)
    expect(b.documentId).not.toBe(a.documentId)
    expect(allDocuments()).toHaveLength(2)
  })

  it('no hash → separate documents', () => {
    const z = lib('zotero', '1')
    const e = lib('eagle', '/lib')
    const a = upsert.upsertDocument(doc(z.id, { contentSha256: null }))
    const b = upsert.upsertDocument(
      doc(e.id, { externalKey: 'X', uri: 'eagle://item/X', contentSha256: null }),
    )
    expect(b.documentId).not.toBe(a.documentId)
  })

  it('annotation upsert updates in place — no duplicates', () => {
    const z = lib('zotero', '1')
    upsert.upsertDocument(doc(z.id))
    upsert.upsertDocument(
      doc(z.id, {
        annotations: [
          {
            externalKey: 'ANN1',
            type: 'highlight',
            text: 'REVISED text about hyperplanes',
            pageLabel: '148',
            modifiedAt: 2000,
          },
        ],
      }),
    )
    const anns = handle.db.select().from(s.annotations).all()
    expect(anns).toHaveLength(1)
    expect(anns[0]?.text).toContain('hyperplanes')
  })

  it('can replace a connector-owned annotation set without leaving stale rows', () => {
    const o = lib('obsidian', '/vault')
    const first = upsert.upsertDocument(
      doc(o.id, {
        externalKey: 'note.md',
        uri: 'obsidian://open?path=/vault/note.md',
        kind: 'note',
        contentSha256: null,
        annotations: [
          { externalKey: 'note.md#body', type: 'note', text: 'body', modifiedAt: 1000 },
          { externalKey: 'note.md#blockquote:0', type: 'highlight', text: 'first', modifiedAt: 1000 },
          { externalKey: 'note.md#blockquote:1', type: 'highlight', text: 'stale', modifiedAt: 1000 },
        ],
      }),
    )

    upsert.upsertDocument(
      doc(o.id, {
        externalKey: 'note.md',
        uri: 'obsidian://open?path=/vault/note.md',
        kind: 'note',
        contentSha256: null,
        replaceAnnotations: true,
        annotations: [
          { externalKey: 'note.md#body', type: 'note', text: 'new body', modifiedAt: 2000 },
          {
            externalKey: 'note.md#blockquote:0',
            type: 'highlight',
            text: 'replacement',
            modifiedAt: 2000,
          },
        ],
      }),
    )

    expect(
      handle.db
        .select({ externalKey: s.annotations.externalKey, text: s.annotations.text })
        .from(s.annotations)
        .where(eq(s.annotations.instanceId, first.instanceId))
        .orderBy(s.annotations.id)
        .all(),
    ).toEqual([
      { externalKey: 'note.md#body', text: 'new body' },
      { externalKey: 'note.md#blockquote:0', text: 'replacement' },
    ])
  })

  it('collections are per-library, parents resolve regardless of order, idempotent', () => {
    const e = lib('eagle', '/lib')
    const tree = [
      { externalKey: 'child', name: 'Papers', parentExternalKey: 'root' },
      { externalKey: 'root', name: 'Library' },
    ]
    upsert.upsertCollections(e.id, tree)
    upsert.upsertCollections(e.id, tree)
    const colls = handle.db.select().from(s.collections).all()
    expect(colls).toHaveLength(2)
    const child = colls.find((c) => c.externalKey === 'child')
    const root = colls.find((c) => c.externalKey === 'root')
    expect(child?.parentId).toBe(root?.id)
    // Same tree in a DIFFERENT library of the same connector → its own rows.
    const e2 = lib('eagle', '/other')
    upsert.upsertCollections(e2.id, tree)
    expect(handle.db.select().from(s.collections).all()).toHaveLength(4)
  })

  it('wipeDerived empties document data but KEEPS connectors/libraries, resets cursors', () => {
    const z = lib('zotero', '1')
    handle.db
      .update(s.libraries)
      .set({ syncCursor: 'v99', lastScanAt: 123 })
      .where(eq(s.libraries.id, z.id))
      .run()
    upsert.upsertDocument(doc(z.id))
    upsert.wipeDerived()
    expect(allDocuments()).toHaveLength(0)
    expect(handle.db.select().from(s.documentInstances).all()).toHaveLength(0)
    const zAfter = handle.db.select().from(s.libraries).where(eq(s.libraries.id, z.id)).get()
    expect(zAfter).toBeDefined()
    expect(zAfter?.syncCursor).toBeNull()
    expect(zAfter?.lastScanAt).toBeNull()
  })
})

describe('pruneUnknownConnectors — decommission self-heal, ghosts survive (spec §2)', () => {
  it('drops the connector, its libraries and instances — but never documents', () => {
    const z = lib('zotero', '1')
    const legacy = lib('legacy', 'old')
    upsert.upsertDocument(doc(z.id))
    const only = upsert.upsertDocument(
      doc(legacy.id, {
        externalKey: 'L1',
        uri: 'legacy://x',
        title: 'Legacy Only Doc',
        contentSha256: 'hash-legacy',
        annotations: undefined,
        tags: undefined,
      }),
    )

    const pruned = upsert.pruneUnknownConnectors(['zotero', 'eagle', 'obsidian'])
    expect(pruned).toBe(1)
    expect(
      handle.db.select().from(s.connectors).all().map((c) => c.key),
    ).not.toContain('legacy')
    // The instance died with its library; the DOCUMENT is a ghost, not gone.
    expect(instancesOf(only.documentId)).toHaveLength(0)
    const ghost = handle.db
      .select()
      .from(s.documents)
      .where(eq(s.documents.id, only.documentId))
      .get()
    expect(ghost?.title).toBe('Legacy Only Doc')
  })

  it('returns 0 and changes nothing when every present connector is registered', () => {
    const z = lib('zotero', '1')
    upsert.upsertDocument(doc(z.id))
    // Connectors/libraries survive wipeDerived by design (spec §2 presence
    // memory), so "registered" = every key currently present.
    const present = handle.db.select().from(s.connectors).all().map((c) => c.key)
    expect(upsert.pruneUnknownConnectors(present)).toBe(0)
    expect(allDocuments()).toHaveLength(1)
  })
})
