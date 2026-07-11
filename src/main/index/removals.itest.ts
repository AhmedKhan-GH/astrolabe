import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { and, eq } from 'drizzle-orm'
import { openDb, type DbHandle } from '../db'
import * as s from '../db/schema'
import { createUpsertApi, type UpsertApi } from './upsert'
import { reconcileRemovals, documentIsOrphaned } from './removals'

/**
 * Tier A integration: the sweep against real SQLite + real migrations + real FK cascades.
 * Proves the set-diff deletes exactly the vanished instances, reports the right affected
 * documents, cascades annotations + outlinks with the instance, and scales to 10⁴ keys.
 */
let dir: string
let handle: DbHandle
let upsert: UpsertApi

/** The sources.id for a source key (ensured by upsert). */
const sourceId = (key: string) => handle.db.select().from(s.sources).where(eq(s.sources.key, key)).get()!.id

/** An instance's externalKey → row (or undefined if swept). */
const instance = (key: string, extKey: string) =>
  handle.db
    .select()
    .from(s.documentInstances)
    .where(and(eq(s.documentInstances.sourceId, sourceId(key)), eq(s.documentInstances.externalKey, extKey)))
    .get()

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'astrolabe-removals-'))
  handle = openDb(join(dir, 'index.db'))
  upsert = createUpsertApi(handle.db)
})
afterEach(() => {
  handle.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('reconcileRemovals — the sweep', () => {
  it('deletes instances whose externalKey is absent from allKeys, keeps the rest', () => {
    upsert.upsertDocument({ sourceKey: 'zotero', externalKey: 'KEEP', uri: 'z://KEEP', title: 'Keep', kind: 'pdf', modifiedAt: 1 })
    upsert.upsertDocument({ sourceKey: 'zotero', externalKey: 'GONE', uri: 'z://GONE', title: 'Gone', kind: 'pdf', modifiedAt: 1 })

    const affected = reconcileRemovals(handle.db, sourceId('zotero'), ['KEEP'])

    expect(instance('zotero', 'KEEP')).toBeDefined()
    expect(instance('zotero', 'GONE')).toBeUndefined()
    // The affected document is the one whose instance vanished.
    expect(affected).toHaveLength(1)
  })

  it('scopes to the given source only — a same-key instance of another source is untouched', () => {
    upsert.upsertDocument({ sourceKey: 'zotero', externalKey: 'X', uri: 'z://X', title: 'Zx', kind: 'pdf', modifiedAt: 1 })
    upsert.upsertDocument({ sourceKey: 'eagle', externalKey: 'X', uri: 'e://X', title: 'Ex', kind: 'pdf', modifiedAt: 1 })

    reconcileRemovals(handle.db, sourceId('zotero'), []) // zotero source emptied

    expect(instance('zotero', 'X')).toBeUndefined()
    expect(instance('eagle', 'X')).toBeDefined() // other source survives
  })

  it('empty allKeys sweeps every instance of the source', () => {
    upsert.upsertDocument({ sourceKey: 'eagle', externalKey: 'A', uri: 'e://A', title: 'A', kind: 'pdf', modifiedAt: 1 })
    upsert.upsertDocument({ sourceKey: 'eagle', externalKey: 'B', uri: 'e://B', title: 'B', kind: 'pdf', modifiedAt: 1 })

    const affected = reconcileRemovals(handle.db, sourceId('eagle'), [])

    expect(handle.db.select().from(s.documentInstances).all()).toHaveLength(0)
    expect(affected).toHaveLength(2)
  })

  it('cascades: a swept instance takes its annotations and outlinks with it (FK CASCADE)', () => {
    // A zotero doc with an annotation, and an obsidian note linking out from its instance.
    upsert.upsertDocument({
      sourceKey: 'zotero', externalKey: 'DOC', uri: 'z://DOC', title: 'Annotated', kind: 'pdf', modifiedAt: 1,
      annotations: [{ externalKey: 'ann1', type: 'highlight', text: 'hello', modifiedAt: 1 }],
    })
    upsert.upsertDocument({
      sourceKey: 'obsidian', externalKey: 'note.md', uri: 'o://note', title: 'Note', kind: 'note', modifiedAt: 1,
      links: ['Some Target'],
    })
    expect(handle.db.select().from(s.annotations).all()).toHaveLength(1)
    expect(handle.db.select().from(s.links).all()).toHaveLength(1)

    reconcileRemovals(handle.db, sourceId('zotero'), []) // sweep the annotated zotero instance
    reconcileRemovals(handle.db, sourceId('obsidian'), []) // sweep the linking note instance

    expect(handle.db.select().from(s.annotations).all()).toHaveLength(0) // cascaded with the instance
    expect(handle.db.select().from(s.links).all()).toHaveLength(0) // cascaded with the source instance
  })

  it('reports affected once per document even when several of its instances vanish', () => {
    // One document, two zotero-ish instances would need two sources; instead assert distinctness
    // by giving one document two instances from the SAME source is impossible (uq), so use the
    // hash join: same content hash → one document reached by two source instances.
    upsert.upsertDocument({ sourceKey: 'zotero', externalKey: 'ZK', uri: 'z://ZK', title: 'Shared', kind: 'pdf', contentSha256: 'deadbeef', modifiedAt: 1 })
    upsert.upsertDocument({ sourceKey: 'eagle', externalKey: 'EK', uri: 'e://EK', title: 'Shared', kind: 'pdf', contentSha256: 'deadbeef', modifiedAt: 1 })
    const docId = handle.db.select().from(s.documents).all()[0]!.id

    // Sweeping zotero leaves the eagle instance — the document is NOT orphaned.
    const affected = reconcileRemovals(handle.db, sourceId('zotero'), [])
    expect(affected).toEqual([docId])
    expect(documentIsOrphaned(handle.db, docId)).toBe(false)

    // Sweeping eagle too orphans it.
    reconcileRemovals(handle.db, sourceId('eagle'), [])
    expect(documentIsOrphaned(handle.db, docId)).toBe(true)
  })

  it('no-op when nothing is stale (idempotent second pass)', () => {
    upsert.upsertDocument({ sourceKey: 'zotero', externalKey: 'K', uri: 'z://K', title: 'K', kind: 'pdf', modifiedAt: 1 })
    expect(reconcileRemovals(handle.db, sourceId('zotero'), ['K'])).toEqual([])
    expect(instance('zotero', 'K')).toBeDefined()
  })

  it('scales past the bound-variable limit: sweeps 2500 stale instances in chunks, keeps a 10⁴ present-set', () => {
    // 2500 indexed zotero instances, plus one that stays. Deleting 2500 at once would blow a
    // single IN(...) — the chunked delete must handle it.
    for (let i = 0; i < 2500; i++)
      upsert.upsertDocument({ sourceKey: 'zotero', externalKey: `OLD${i}`, uri: `z://OLD${i}`, title: `O${i}`, kind: 'pdf', modifiedAt: 1 })
    upsert.upsertDocument({ sourceKey: 'zotero', externalKey: 'SURVIVOR', uri: 'z://s', title: 'S', kind: 'pdf', modifiedAt: 1 })
    // A present-set of 10⁴ keys that includes only SURVIVOR of the indexed ones.
    const allKeys = ['SURVIVOR', ...Array.from({ length: 10_000 }, (_, i) => `PHANTOM${i}`)]

    const affected = reconcileRemovals(handle.db, sourceId('zotero'), allKeys)

    expect(affected).toHaveLength(2500)
    expect(instance('zotero', 'SURVIVOR')).toBeDefined()
    expect(instance('zotero', 'OLD0')).toBeUndefined()
    expect(instance('zotero', 'OLD2499')).toBeUndefined()
    expect(handle.db.select().from(s.documentInstances).all()).toHaveLength(1)
  })
})
