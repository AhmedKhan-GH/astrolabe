import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, type DbHandle } from '../../db'
import { createUpsertApi, type UpsertApi } from '../../index/upsert'
import { createIndexQueries, type IndexQueries } from '../../index/queries'
import { syncConnector } from '../../index/sync'
import { sha256File } from '../../lib/hash'
import type { EagleClient } from './client'
import { createEagleConnector } from './index'

/**
 * Tier A integration: the Eagle connector v2 against real SQLite + real migrations +
 * real files on disk, landed by the REAL sync runner (index/sync.ts) — the connector
 * only returns per-library payloads; sync owns every write, the sweep, and presence.
 * We drive the full scan through a FAKE injected client (no live Eagle); fixtures point
 * at temp files we create + hash for real.
 *
 * The money assertion is the hash join — a PDF held in BOTH Zotero and Eagle collapses
 * to ONE document with TWO instances. The v2 assertion is the library switch — scanning
 * library A then switching Eagle to library B marks A DORMANT and deletes NOTHING from A
 * (spec §2); v1's connector-wide diff read that as mass deletion.
 *
 * Real files live under <lib>/images/<id>.info/<name>.<ext> — mapping.resolveFilePath
 * computes exactly that path, so writing byte content there makes sha256File in scan
 * produce a genuine hash (the same layout Eagle uses in production).
 */
let dir: string
let handle: DbHandle
let upsert: UpsertApi
let queries: IndexQueries

/** Write byte content to the on-disk layout Eagle uses; returns the absolute file path. */
function writeItemFile(libraryPath: string, id: string, name: string, ext: string, content: string): string {
  const infoDir = join(libraryPath, 'images', `${id}.info`)
  mkdirSync(infoDir, { recursive: true })
  const filePath = join(infoDir, `${name}.${ext}`)
  writeFileSync(filePath, content)
  return filePath
}

/** A fake EagleClient serving a MUTABLE library holder (path/name/folders/items).
 *  Reading state live is what lets a single connector observe a library SWITCH. */
interface FakeState {
  path: string
  name?: string
  folders: unknown[]
  items: unknown[]
}
function fakeClient(state: FakeState): EagleClient {
  return {
    applicationInfo: async () => ({ version: '4.0.0' }),
    libraryInfo: async () => ({ path: state.path, name: state.name, folders: state.folders }),
    itemList: async ({ page }) => (page === 0 ? state.items : []),
    folderList: async () => state.folders,
    knownLibraries: async () => [state.path],
    switchLibrary: async () => {},
  }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'astrolabe-eagle-'))
  handle = openDb(join(dir, 'index.db'))
  upsert = createUpsertApi(handle.db)
  queries = createIndexQueries(handle.db)
})
afterEach(() => {
  handle.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('eagle sync — items land', () => {
  it('upserts folders (nested), items, tags, and folder membership; one library keyed by path', async () => {
    const libraryPath = join(dir, 'Books.library')
    writeItemFile(libraryPath, 'E1', 'griffiths', 'pdf', 'griffiths quantum content')
    const folders = [
      { id: 'ROOT', name: 'Courses', children: [{ id: 'SUB', name: 'Griffiths', children: [] }] },
    ]
    const items = [
      { id: 'E1', name: 'griffiths', ext: 'pdf', tags: ['quantum', 'science'], folders: ['SUB'], isDeleted: false, modificationTime: 1000 },
    ]
    const conn = createEagleConnector({ client: fakeClient({ path: libraryPath, name: 'Books', folders, items }) })

    const outcome = await syncConnector(handle.db, upsert, conn)

    expect(outcome.status).toBe('ok')
    expect(outcome.libraries).toHaveLength(1)
    expect(outcome.libraries[0]?.stableKey).toBe(libraryPath)
    expect(outcome.libraries[0]?.displayName).toBe('Books')
    expect(outcome.libraries[0]?.documentsUpserted).toBe(1)

    const hits = queries.search({ q: 'griffiths' })
    expect(hits).toHaveLength(1)
    expect(hits[0]?.kind).toBe('pdf')
    expect(hits[0]?.tags.sort()).toEqual(['quantum', 'science'])
    expect(hits[0]?.instances[0]?.uri).toBe('eagle://item/E1')
    expect(hits[0]?.instances[0]?.connectorKey).toBe('eagle')
  })

  it('falls back to the path basename when Eagle reports no library name', async () => {
    const libraryPath = join(dir, 'Nameless.library')
    const conn = createEagleConnector({ client: fakeClient({ path: libraryPath, folders: [], items: [] }) })
    const outcome = await syncConnector(handle.db, upsert, conn)
    expect(outcome.libraries[0]?.displayName).toBe('Nameless.library')
  })

  it('skips deleted rows and does not hash a bookmark with no ext', async () => {
    const libraryPath = join(dir, 'Books.library')
    const items = [
      { id: 'LINK', name: 'ARM ref', tags: [], folders: [], url: 'https://developer.arm.com', isDeleted: false, modificationTime: 500 },
      { id: 'TRASH', name: 'gone', ext: 'pdf', tags: [], folders: [], isDeleted: true, modificationTime: 400 },
    ]
    const conn = createEagleConnector({ client: fakeClient({ path: libraryPath, folders: [], items }) })
    const outcome = await syncConnector(handle.db, upsert, conn)
    expect(outcome.libraries[0]?.documentsUpserted).toBe(1) // only the bookmark; trash excluded
    expect(queries.search({ q: 'ARM' })).toHaveLength(1)
  })
})

describe('eagle sync — THE HASH JOIN (Zotero↔Eagle, the money logic)', () => {
  it('same PDF in Zotero and Eagle → ONE document, TWO instances, tags merged', async () => {
    const libraryPath = join(dir, 'Books.library')
    // 1. A real file on disk at Eagle's layout — scan hashes it for real.
    writeItemFile(libraryPath, 'MQG0GMKZ', 'Murphy ProbabilisticML', 'pdf', 'the exact bytes of murphy pml')

    // 2. Zotero already holds the same file (same content) — seed it directly by
    //    hashing the same bytes into a zotero library.
    const sha = await sha256File(join(libraryPath, 'images', 'MQG0GMKZ.info', 'Murphy ProbabilisticML.pdf'))
    expect(sha).toBeTruthy()
    const zlib = upsert.ensureLibrary('zotero', 'personal', 'My Library')
    upsert.upsertDocument({
      libraryId: zlib.id,
      externalKey: 'ABC123',
      uri: 'zotero://select/library/items/ABC123',
      title: 'Probabilistic Machine Learning',
      kind: 'pdf',
      contentSha256: sha,
      modifiedAt: 900,
      tags: ['ml', 'textbook'],
    })

    // 3. Eagle scans the same file (connector hashes it → same sha → join).
    const items = [
      { id: 'MQG0GMKZ', name: 'Murphy ProbabilisticML', ext: 'pdf', tags: ['reference'], folders: [], isDeleted: false, modificationTime: 1000 },
    ]
    const conn = createEagleConnector({ client: fakeClient({ path: libraryPath, name: 'Books', folders: [], items }) })
    await syncConnector(handle.db, upsert, conn)

    // 4. ONE document, TWO provenance instances, tags from both sources merged.
    const hits = queries.search({ q: 'probabilistic' })
    expect(hits).toHaveLength(1)
    expect(hits[0]?.instances.map((i) => i.connectorKey).sort()).toEqual(['eagle', 'zotero'])
    expect(hits[0]?.tags.sort()).toEqual(['ml', 'reference', 'textbook'])
  })

  it('different bytes → no join (two separate documents)', async () => {
    const libraryPath = join(dir, 'Books.library')
    const zFile = writeItemFile(libraryPath, 'Z1', 'zoterocopy', 'pdf', 'zotero bytes')
    const zSha = await sha256File(zFile)
    const zlib = upsert.ensureLibrary('zotero', 'personal', 'My Library')
    upsert.upsertDocument({
      libraryId: zlib.id, externalKey: 'Z1', uri: 'zotero://z1', title: 'ZoteroOnlyPaper',
      kind: 'pdf', contentSha256: zSha, modifiedAt: 900,
    })
    writeItemFile(libraryPath, 'E9', 'eaglecopy', 'pdf', 'entirely different eagle bytes')
    const items = [{ id: 'E9', name: 'EagleOnlyPaper', ext: 'pdf', tags: [], folders: [], isDeleted: false, modificationTime: 1000 }]
    const conn = createEagleConnector({ client: fakeClient({ path: libraryPath, name: 'Books', folders: [], items }) })
    await syncConnector(handle.db, upsert, conn)

    const zHits = queries.search({ q: 'ZoteroOnlyPaper' })
    const eHits = queries.search({ q: 'EagleOnlyPaper' })
    expect(zHits).toHaveLength(1)
    expect(eHits).toHaveLength(1)
    expect(zHits[0]?.documentId).not.toBe(eHits[0]?.documentId)
  })
})

describe('eagle sync — removal reconciliation (allExternalKeys → library-scoped sweep)', () => {
  it('scan emits every non-deleted id and omits a trashed item', async () => {
    const libraryPath = join(dir, 'Books.library')
    writeItemFile(libraryPath, 'LIVE', 'live', 'pdf', 'live bytes')
    const items = [
      { id: 'LIVE', name: 'live', ext: 'pdf', tags: [], folders: [], isDeleted: false, modificationTime: 1000 },
      { id: 'DEAD', name: 'dead', ext: 'pdf', tags: [], folders: [], isDeleted: true, modificationTime: 1000 },
    ]
    const conn = createEagleConnector({ client: fakeClient({ path: libraryPath, folders: [], items }) })
    const scan = await conn.scan({ cursors: new Map() })
    expect(scan.libraries[0]?.allExternalKeys).toEqual(['LIVE']) // trashed DEAD excluded
  })

  it('an item that becomes trashed is SWEPT on the next sync (document removed)', async () => {
    const libraryPath = join(dir, 'Books.library')
    writeItemFile(libraryPath, 'E1', 'quantumnotes', 'pdf', 'quantum content')
    const state: FakeState = {
      path: libraryPath,
      name: 'Books',
      folders: [],
      items: [{ id: 'E1', name: 'quantumnotes', ext: 'pdf', tags: [], folders: [], isDeleted: false, modificationTime: 1000 }],
    }
    const conn = createEagleConnector({ client: fakeClient(state) })
    await syncConnector(handle.db, upsert, conn)
    expect(queries.search({ q: 'quantumnotes' })).toHaveLength(1)

    // Next sync: E1 is now trashed → mapItems drops it → allExternalKeys omits E1 → swept.
    state.items = [{ id: 'E1', name: 'quantumnotes', ext: 'pdf', tags: [], folders: [], isDeleted: true, modificationTime: 2000 }]
    const outcome = await syncConnector(handle.db, upsert, conn)

    expect(outcome.libraries[0]?.removed).toBe(1)
    expect(queries.search({ q: 'quantumnotes' })).toHaveLength(0)
  })
})

describe('eagle sync — incremental watermark cursor', () => {
  it('re-upserts only items newer than the persisted cursor and advances it', async () => {
    const libraryPath = join(dir, 'Books.library')
    writeItemFile(libraryPath, 'OLD', 'olddoc', 'pdf', 'old')
    const state: FakeState = {
      path: libraryPath,
      name: 'Books',
      folders: [],
      items: [{ id: 'OLD', name: 'olddoc', ext: 'pdf', tags: [], folders: [], isDeleted: false, modificationTime: 1000 }],
    }
    const conn = createEagleConnector({ client: fakeClient(state) })

    const first = await syncConnector(handle.db, upsert, conn)
    expect(first.libraries[0]?.documentsUpserted).toBe(1)

    // Add a newer item; OLD is unchanged (≤ cursor 1000) so only NEW is re-upserted.
    writeItemFile(libraryPath, 'NEW', 'newdoc', 'pdf', 'new')
    state.items = [
      { id: 'OLD', name: 'olddoc', ext: 'pdf', tags: [], folders: [], isDeleted: false, modificationTime: 1000 },
      { id: 'NEW', name: 'newdoc', ext: 'pdf', tags: [], folders: [], isDeleted: false, modificationTime: 2000 },
    ]
    const second = await syncConnector(handle.db, upsert, conn)
    expect(second.libraries[0]?.documentsUpserted).toBe(1) // only NEW (2000 > 1000)
    expect(second.libraries[0]?.unchanged).toBe(false)
    expect(queries.search({ q: 'newdoc' })).toHaveLength(1)
    expect(queries.search({ q: 'olddoc' })).toHaveLength(1) // OLD survives (not re-upserted, not swept)
  })

  it('a re-sync with no newer item is unchanged: nothing upserted, nothing removed', async () => {
    const libraryPath = join(dir, 'Books.library')
    writeItemFile(libraryPath, 'E1', 'stabledoc', 'pdf', 'stable')
    const state: FakeState = {
      path: libraryPath,
      name: 'Books',
      folders: [],
      items: [{ id: 'E1', name: 'stabledoc', ext: 'pdf', tags: [], folders: [], isDeleted: false, modificationTime: 1000 }],
    }
    const conn = createEagleConnector({ client: fakeClient(state) })
    await syncConnector(handle.db, upsert, conn)
    const second = await syncConnector(handle.db, upsert, conn)
    expect(second.libraries[0]?.unchanged).toBe(true)
    expect(second.libraries[0]?.documentsUpserted).toBe(0)
    expect(second.libraries[0]?.removed).toBe(0)
    expect(queries.search({ q: 'stabledoc' })).toHaveLength(1)
  })
})

describe('eagle sync — stableKey normalization (review finding)', () => {
  it('a trailing-slash /library/info path still yields the normalized (slashless) stableKey', async () => {
    const libraryPath = join(dir, 'Books.library')
    writeItemFile(libraryPath, 'E1', 'griffiths', 'pdf', 'griffiths quantum content')
    const items = [
      { id: 'E1', name: 'griffiths', ext: 'pdf', tags: [], folders: [], isDeleted: false, modificationTime: 1000 },
    ]
    // Eagle reports the SAME library with a trailing slash — client.knownLibraries()
    // and switchLibrary() both normalize (client.ts normalizeLibraryPath), so the
    // scan's stableKey must match or the rail sees two rows for one library.
    const conn = createEagleConnector({
      client: fakeClient({ path: `${libraryPath}/`, name: 'Books', folders: [], items }),
    })

    const outcome = await syncConnector(handle.db, upsert, conn)

    expect(outcome.libraries[0]?.stableKey).toBe(libraryPath) // normalized, no trailing slash
    const snap = queries.librariesSnapshot()
    expect(snap.libraries.find((l) => l.stableKey === libraryPath)).toBeDefined()
    expect(snap.libraries).toHaveLength(1) // not split into two rows
  })
})

describe('eagle sync — THE LIBRARY SWITCH (v2 semantic, spec §2)', () => {
  it('switching Eagle to another library marks the first DORMANT and deletes NOTHING from it', async () => {
    const libA = join(dir, 'Books.library')
    const libB = join(dir, 'Papers.library')
    writeItemFile(libA, 'A1', 'quantumnotes', 'pdf', 'A content')
    const state: FakeState = {
      path: libA,
      name: 'Books',
      folders: [],
      items: [{ id: 'A1', name: 'quantumnotes', ext: 'pdf', tags: [], folders: [], isDeleted: false, modificationTime: 1000 }],
    }
    const conn = createEagleConnector({ client: fakeClient(state) })
    await syncConnector(handle.db, upsert, conn)
    expect(queries.search({ q: 'quantumnotes' })).toHaveLength(1)

    // Eagle now has a DIFFERENT library open — its whole corpus changes.
    writeItemFile(libB, 'B1', 'mlpapers', 'pdf', 'B content')
    state.path = libB
    state.name = 'Papers'
    state.items = [{ id: 'B1', name: 'mlpapers', ext: 'pdf', tags: [], folders: [], isDeleted: false, modificationTime: 2000 }]
    const outcome = await syncConnector(handle.db, upsert, conn)

    // The scan named only library B → B is live; A was untouched (dormant), NOT swept.
    expect(outcome.libraries).toHaveLength(1)
    expect(outcome.libraries[0]?.stableKey).toBe(libB)

    const snap = queries.librariesSnapshot()
    const a = snap.libraries.find((l) => l.stableKey === libA)
    const b = snap.libraries.find((l) => l.stableKey === libB)
    expect(a?.availability).toBe('dormant')
    expect(a?.documentCount).toBe(1) // A's instance survives — NOTHING deleted
    expect(b?.availability).toBe('live')
    expect(b?.documentCount).toBe(1)

    // Both documents remain findable (dormant ≠ deleted; dormant ≠ hidden from search).
    expect(queries.search({ q: 'quantumnotes' })).toHaveLength(1)
    expect(queries.search({ q: 'mlpapers' })).toHaveLength(1)
  })
})
