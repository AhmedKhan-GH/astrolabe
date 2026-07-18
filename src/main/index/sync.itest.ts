import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { openDb, type DbHandle } from '../db'
import { createUpsertApi, type UpsertApi } from './upsert'
import { createIndexQueries, type IndexQueries } from './queries'
import { syncConnector } from './sync'
import { forgetLibrary } from './removals'
import * as s from '../db/schema'
import type { Connector, ConnectorScan, LibraryScanResult } from '../connectors/types'

/**
 * Tier A integration: the sync runner against real SQLite — landing multi-
 * library scans, per-library cursors, the sweep + FTS refresh, and the v2
 * presence rules (unmentioned → dormant; unavailable → all dormant; gone
 * stays gone). Driven by a scripted fake connector — the zotero connector's
 * own translation is covered by its fixture tests; live truth at Gate S.
 */
let dir: string
let handle: DbHandle
let upsert: UpsertApi
let queries: IndexQueries

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'astrolabe-sync-'))
  handle = openDb(join(dir, 'index.db'))
  upsert = createUpsertApi(handle.db)
  queries = createIndexQueries(handle.db)
})
afterAll(() => {
  handle.close()
  rmSync(dir, { recursive: true, force: true })
})
beforeEach(() => {
  upsert.wipeDerived()
  handle.db.delete(s.libraries).run()
  handle.db.delete(s.connectors).run()
})

const libScan = (stableKey: string, over: Partial<LibraryScanResult> = {}): LibraryScanResult => ({
  stableKey,
  displayName: stableKey,
  cursor: 'v1',
  unchanged: false,
  documents: [
    {
      externalKey: `${stableKey}-DOC`,
      uri: `zotero://select/x/${stableKey}`,
      title: `Doc of ${stableKey}`,
      kind: 'pdf',
      contentSha256: `hash-${stableKey}`,
      modifiedAt: 1,
    },
  ],
  collections: [],
  allExternalKeys: [`${stableKey}-DOC`],
  ...over,
})

function fakeConnector(over: {
  available?: boolean
  scans?: ConnectorScan
  onScan?: (cursors: ReadonlyMap<string, string | null>) => ConnectorScan
}): Connector {
  return {
    key: 'zotero',
    checkAvailable: async () => ({ available: over.available ?? true }),
    scan: async (ctx) =>
      over.onScan ? over.onScan(ctx.cursors) : (over.scans ?? { libraries: [] }),
  }
}

const libRow = (stableKey: string) =>
  handle.db.select().from(s.libraries).where(eq(s.libraries.stableKey, stableKey)).get()

describe('syncConnector — landing scans', () => {
  it('lands multi-library scans: rows live, cursors + lastScanAt persisted, docs searchable', async () => {
    const out = await syncConnector(
      handle.db,
      upsert,
      fakeConnector({ scans: { libraries: [libScan('personal'), libScan('group:7')] } }),
      777,
    )
    expect(out.status).toBe('ok')
    expect(out.libraries.map((l) => l.documentsUpserted)).toEqual([1, 1])
    const p = libRow('personal')
    expect(p?.availability).toBe('live')
    expect(p?.syncCursor).toBe('v1')
    expect(p?.lastScanAt).toBe(777)
    expect(queries.search({ q: 'Doc' })).toHaveLength(2)
  })

  it('passes each library its OWN cursor and honors unchanged (no upserts, sweep still runs)', async () => {
    await syncConnector(
      handle.db,
      upsert,
      fakeConnector({ scans: { libraries: [libScan('personal', { cursor: 'v5' })] } }),
    )
    let sawCursor: string | null = 'unset'
    const second = fakeConnector({
      onScan: (cursors) => {
        sawCursor = cursors.get('personal') ?? null
        return {
          libraries: [
            libScan('personal', { unchanged: true, documents: [], allExternalKeys: ['personal-DOC'] }),
          ],
        }
      },
    })
    const out = await syncConnector(handle.db, upsert, second)
    expect(sawCursor).toBe('v5')
    expect(out.libraries[0]?.unchanged).toBe(true)
    expect(out.libraries[0]?.documentsUpserted).toBe(0)
    expect(queries.search({ q: 'Doc' })).toHaveLength(1) // first sync's doc intact
  })

  it('sweeps within the scanned library and refreshes FTS for swept ghosts', async () => {
    await syncConnector(
      handle.db,
      upsert,
      fakeConnector({ scans: { libraries: [libScan('personal')] } }),
    )
    // Next scan: the doc is gone from the library.
    const out = await syncConnector(
      handle.db,
      upsert,
      fakeConnector({
        scans: {
          libraries: [libScan('personal', { unchanged: true, documents: [], allExternalKeys: [] })],
        },
      }),
    )
    expect(out.libraries[0]?.removed).toBe(1)
    expect(queries.search({ q: 'Doc' })).toHaveLength(0) // ghost: hidden by default
    expect(queries.search({ q: 'Doc', includeGhosts: true })).toHaveLength(1) // …but remembered
  })
})

describe('syncConnector — presence rules (spec §2)', () => {
  it('a known library the scan does not mention goes DORMANT; nothing deleted', async () => {
    await syncConnector(
      handle.db,
      upsert,
      fakeConnector({ scans: { libraries: [libScan('personal'), libScan('group:7')] } }),
    )
    // Next scan: group:7 vanished from enumeration (left the group / offline).
    await syncConnector(
      handle.db,
      upsert,
      fakeConnector({
        scans: { libraries: [libScan('personal', { unchanged: true, documents: [] })] },
      }),
    )
    expect(libRow('group:7')?.availability).toBe('dormant')
    expect(queries.search({ q: 'Doc' })).toHaveLength(2) // both docs still anchored
  })

  it('connector unavailable → status recorded, ALL libraries dormant, nothing deleted', async () => {
    await syncConnector(
      handle.db,
      upsert,
      fakeConnector({ scans: { libraries: [libScan('personal')] } }),
    )
    const out = await syncConnector(handle.db, upsert, fakeConnector({ available: false }))
    expect(out.status).toBe('unavailable')
    expect(libRow('personal')?.availability).toBe('dormant')
    const snap = queries.librariesSnapshot()
    expect(snap.connectors[0]?.status).toBe('unavailable')
    expect(queries.search({ q: 'Doc' })).toHaveLength(1)
  })

  it('a scan() throw degrades identically (dormant, nothing deleted)', async () => {
    await syncConnector(
      handle.db,
      upsert,
      fakeConnector({ scans: { libraries: [libScan('personal')] } }),
    )
    const broken: Connector = {
      key: 'zotero',
      checkAvailable: async () => ({ available: true }),
      scan: async () => {
        throw new Error('mid-scan explosion')
      },
    }
    const out = await syncConnector(handle.db, upsert, broken)
    expect(out.status).toBe('unavailable')
    expect(libRow('personal')?.availability).toBe('dormant')
    expect(queries.search({ q: 'Doc' })).toHaveLength(1)
  })

  it('a GONE library stays gone even when the connector still reports it', async () => {
    await syncConnector(
      handle.db,
      upsert,
      fakeConnector({ scans: { libraries: [libScan('personal')] } }),
    )
    const row = libRow('personal')
    forgetLibrary(handle.db, row!.id)
    await syncConnector(
      handle.db,
      upsert,
      fakeConnector({ scans: { libraries: [libScan('personal')] } }),
    )
    expect(libRow('personal')?.availability).toBe('gone')
    expect(queries.search({ q: 'Doc' })).toHaveLength(0) // no resurrection
  })
})
