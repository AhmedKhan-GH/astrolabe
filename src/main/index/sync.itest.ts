import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq, inArray } from 'drizzle-orm'
import { openDb, type DbHandle } from '../db'
import { createUpsertApi, type UpsertApi } from './upsert'
import { createIndexQueries, type IndexQueries } from './queries'
import { syncConnector, type InstanceRenamedEvent } from './sync'
import { forgetLibrary } from './removals'
import * as s from '../db/schema'
import type { Connector, ConnectorScan, LibraryDocumentInput, LibraryScanResult } from '../connectors/types'

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

/** A note-shaped document carrying a renameHint (top-level + persisted in metaJson),
 *  the shape the healing pass pairs on (spec §1). */
const noteDoc = (
  key: string,
  hint: string,
  over: Partial<LibraryDocumentInput> = {},
): LibraryDocumentInput => ({
  externalKey: key,
  uri: `obsidian://open?path=${key}`,
  title: `Note ${key}`,
  kind: 'note',
  filePath: `/vault/${key}`,
  contentSha256: null,
  renameHint: hint,
  metaJson: JSON.stringify({ renameHint: hint }),
  modifiedAt: 1,
  ...over,
})

/** A note library scan payload (allExternalKeys present → sweep + healing eligible). */
const noteLib = (
  stableKey: string,
  documents: LibraryDocumentInput[],
  allExternalKeys: string[],
): LibraryScanResult => ({
  stableKey,
  displayName: stableKey,
  cursor: 'v1',
  unchanged: false,
  documents,
  collections: [],
  allExternalKeys,
})

const instByKey = (key: string) =>
  handle.db.select().from(s.documentInstances).where(eq(s.documentInstances.externalKey, key)).get()

describe('syncConnector — rename healing (spec §2)', () => {
  it('heals a rename: SAME documentId, no ghost, key/uri/path updated, callback fired once', async () => {
    await syncConnector(
      handle.db,
      upsert,
      fakeConnector({ scans: { libraries: [noteLib('personal', [noteDoc('a.md', 'H')], ['a.md'])] } }),
    )
    const docId = instByKey('a.md')!.documentId

    const events: InstanceRenamedEvent[] = []
    await syncConnector(
      handle.db,
      upsert,
      fakeConnector({
        scans: {
          libraries: [
            noteLib(
              'personal',
              [noteDoc('c.md', 'H', { uri: 'obsidian://c', filePath: '/vault/c.md' })],
              ['c.md'],
            ),
          ],
        },
      }),
      999,
      { onInstanceRenamed: (e) => events.push(e) },
    )

    const after = instByKey('c.md')!
    expect(after.documentId).toBe(docId) // the document row survives untouched
    expect(after.uri).toBe('obsidian://c') // instance re-pointed to the new note
    expect(after.filePath).toBe('/vault/c.md')
    expect(instByKey('a.md')).toBeUndefined() // old key gone, not left as a stale row
    expect(queries.indexStats().ghosts).toBe(0) // nothing ghosted — continuity preserved
    expect(events).toEqual([{ library: 'zotero:personal', oldKey: 'a.md', newKey: 'c.md' }])
  })

  it('ambiguity — two identical-content notes, one renamed (surviving duplicate) heals NOTHING', async () => {
    // a.md and b.md share content (hint H). Rename a.md → c.md; b.md survives.
    // c.md could be a copy of b.md, so the hint is ambiguous — the safe default.
    await syncConnector(
      handle.db,
      upsert,
      fakeConnector({
        scans: {
          libraries: [noteLib('personal', [noteDoc('a.md', 'H'), noteDoc('b.md', 'H')], ['a.md', 'b.md'])],
        },
      }),
    )
    const bDocId = instByKey('b.md')!.documentId

    const events: InstanceRenamedEvent[] = []
    await syncConnector(
      handle.db,
      upsert,
      fakeConnector({
        scans: { libraries: [noteLib('personal', [noteDoc('c.md', 'H')], ['b.md', 'c.md'])] },
      }),
      999,
      { onInstanceRenamed: (e) => events.push(e) },
    )

    expect(events).toEqual([]) // surviving duplicate → no heal
    expect(queries.indexStats().ghosts).toBe(1) // a.md swept to a ghost
    expect(instByKey('a.md')).toBeUndefined()
    expect(instByKey('c.md')!.documentId).not.toBe(bDocId) // c.md is its OWN fresh document
  })

  it('ambiguity — duplicate-content renames (hint maps to 2 removed + 2 added) heal NOTHING', async () => {
    await syncConnector(
      handle.db,
      upsert,
      fakeConnector({
        scans: {
          libraries: [noteLib('personal', [noteDoc('a.md', 'H'), noteDoc('b.md', 'H')], ['a.md', 'b.md'])],
        },
      }),
    )

    const events: InstanceRenamedEvent[] = []
    await syncConnector(
      handle.db,
      upsert,
      fakeConnector({
        scans: {
          libraries: [noteLib('personal', [noteDoc('c.md', 'H'), noteDoc('d.md', 'H')], ['c.md', 'd.md'])],
        },
      }),
      999,
      { onInstanceRenamed: (e) => events.push(e) },
    )

    expect(events).toEqual([]) // ambiguous hint → the safe default: no heal
    expect(queries.indexStats().ghosts).toBe(2) // both originals swept to ghosts
    expect(
      handle.db
        .select()
        .from(s.documentInstances)
        .where(inArray(s.documentInstances.externalKey, ['a.md', 'b.md']))
        .all(),
    ).toHaveLength(0)
  })

  it('a renamed-AND-edited note (hint changed) does not heal — old ghosts, new document', async () => {
    await syncConnector(
      handle.db,
      upsert,
      fakeConnector({ scans: { libraries: [noteLib('personal', [noteDoc('a.md', 'H1')], ['a.md'])] } }),
    )
    const events: InstanceRenamedEvent[] = []
    await syncConnector(
      handle.db,
      upsert,
      fakeConnector({ scans: { libraries: [noteLib('personal', [noteDoc('c.md', 'H2')], ['c.md'])] } }),
      999,
      { onInstanceRenamed: (e) => events.push(e) },
    )
    expect(events).toEqual([])
    expect(queries.indexStats().ghosts).toBe(1) // a.md ghosts; c.md is a fresh document
    expect(instByKey('c.md')!.documentId).not.toBe(instByKey('a.md')?.documentId ?? -1)
  })

  it('an identical hint in a DIFFERENT library never pairs (healing is library-scoped)', async () => {
    await syncConnector(
      handle.db,
      upsert,
      fakeConnector({
        scans: {
          libraries: [
            noteLib('vaultA', [noteDoc('a.md', 'H')], ['a.md']),
            noteLib('vaultB', [noteDoc('x.md', 'Z')], ['x.md']),
          ],
        },
      }),
    )
    const events: InstanceRenamedEvent[] = []
    // A loses a.md; B gains c.md with the SAME hint H — must NOT cross-pair.
    await syncConnector(
      handle.db,
      upsert,
      fakeConnector({
        scans: {
          libraries: [
            noteLib('vaultA', [], []),
            noteLib('vaultB', [noteDoc('x.md', 'Z'), noteDoc('c.md', 'H')], ['x.md', 'c.md']),
          ],
        },
      }),
      999,
      { onInstanceRenamed: (e) => events.push(e) },
    )
    expect(events).toEqual([]) // library-scoped: A's removed cannot pair with B's added
    expect(queries.indexStats().ghosts).toBe(1) // a.md ghosted in vault A
  })
})

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
