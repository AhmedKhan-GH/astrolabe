import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { openDb, type DbHandle } from '../db'
import { createUpsertApi, type UpsertApi } from './upsert'
import {
  reconcileRemovals,
  documentIsGhost,
  markLibraryAvailability,
  forgetLibrary,
} from './removals'
import * as s from '../db/schema'

/**
 * Tier A integration: the v2 removal sweep (spine spec v2 §2). The headline
 * rule: removals are LIBRARY-scoped — a scan can only kill instances of the
 * library it observed. v1 diffed connector-wide, so switching Eagle libraries
 * read as mass deletion; the first test is that bug's regression fence.
 */
let dir: string
let handle: DbHandle
let upsert: UpsertApi

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'astrolabe-removals-'))
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

const put = (libraryId: number, externalKey: string, sha: string | null = null) =>
  upsert.upsertDocument({
    libraryId,
    externalKey,
    uri: `x://${externalKey}`,
    title: `Doc ${externalKey}`,
    kind: 'pdf',
    contentSha256: sha,
    modifiedAt: 1,
  })

const instanceCount = (libraryId: number) =>
  handle.db
    .select()
    .from(s.documentInstances)
    .where(eq(s.documentInstances.libraryId, libraryId))
    .all().length

describe('reconcileRemovals — library-scoped sweep', () => {
  it('THE LIBRARY-SWITCH FENCE: sweeping library A never touches library B of the same connector', () => {
    const a = lib('eagle', '/lib-A')
    const b = lib('eagle', '/lib-B')
    put(a.id, 'A1')
    put(a.id, 'A2')
    put(b.id, 'B1')
    put(b.id, 'B2')

    // Eagle switched to B: a scan of B sees only B's keys. Sweeping B with its
    // full key set deletes nothing — and A (unscanned, dormant) is untouchable.
    expect(reconcileRemovals(handle.db, b.id, ['B1', 'B2'])).toEqual([])
    expect(instanceCount(a.id)).toBe(2)
    expect(instanceCount(b.id)).toBe(2)
  })

  it('deletes exactly the instances a live scan of their OWN library omits', () => {
    const a = lib('zotero', '1')
    put(a.id, 'K1')
    const gone = put(a.id, 'K2')
    const affected = reconcileRemovals(handle.db, a.id, ['K1'])
    expect(affected).toEqual([gone.documentId])
    expect(instanceCount(a.id)).toBe(1)
  })

  it('a document with copies in two libraries survives removal in one (still anchored)', () => {
    const personal = lib('zotero', '1')
    const group = lib('zotero', 'group:7')
    const p = put(personal.id, 'P1', 'hash-shared')
    const g = put(group.id, 'G1', 'hash-shared')
    expect(g.documentId).toBe(p.documentId)

    reconcileRemovals(handle.db, personal.id, [])
    expect(documentIsGhost(handle.db, p.documentId)).toBe(false)
    expect(instanceCount(group.id)).toBe(1)
  })

  it('sole-copy removal leaves a GHOST: document row + zero instances (never pruned)', () => {
    const a = lib('zotero', '1')
    const only = put(a.id, 'K1', 'hash-solo')
    reconcileRemovals(handle.db, a.id, [])
    expect(documentIsGhost(handle.db, only.documentId)).toBe(true)
    const row = handle.db
      .select()
      .from(s.documents)
      .where(eq(s.documents.id, only.documentId))
      .get()
    expect(row?.contentSha256).toBe('hash-solo')
  })

  it('is idempotent: a second sweep with the same key set finds nothing', () => {
    const a = lib('zotero', '1')
    put(a.id, 'K1')
    put(a.id, 'K2')
    expect(reconcileRemovals(handle.db, a.id, ['K1'])).toHaveLength(1)
    expect(reconcileRemovals(handle.db, a.id, ['K1'])).toEqual([])
  })
})

describe('availability — dormant marks, never deletes (spec §2)', () => {
  it('markLibraryAvailability(dormant) flips the flag and deletes nothing', () => {
    const a = lib('eagle', '/lib-A')
    put(a.id, 'A1')
    markLibraryAvailability(handle.db, a.id, 'dormant')
    const row = handle.db.select().from(s.libraries).where(eq(s.libraries.id, a.id)).get()
    expect(row?.availability).toBe('dormant')
    expect(instanceCount(a.id)).toBe(1)
  })

  it('markLibraryAvailability(live) stamps lastSeenAt', () => {
    const a = lib('eagle', '/lib-A')
    markLibraryAvailability(handle.db, a.id, 'dormant')
    markLibraryAvailability(handle.db, a.id, 'live', 12345)
    const row = handle.db.select().from(s.libraries).where(eq(s.libraries.id, a.id)).get()
    expect(row?.availability).toBe('live')
    expect(row?.lastSeenAt).toBe(12345)
  })
})

describe('forgetLibrary — the explicit gone verdict (spec §2)', () => {
  it('drops the library instances, keeps the verdict row, documents become ghosts', () => {
    const a = lib('eagle', '/lib-A')
    const only = put(a.id, 'A1', 'hash-a1')
    forgetLibrary(handle.db, a.id)

    const row = handle.db.select().from(s.libraries).where(eq(s.libraries.id, a.id)).get()
    expect(row?.availability).toBe('gone')
    expect(instanceCount(a.id)).toBe(0)
    expect(documentIsGhost(handle.db, only.documentId)).toBe(true)
  })
})
