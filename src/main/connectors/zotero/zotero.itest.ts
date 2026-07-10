import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { openDb, type DbHandle } from '../../db'
import { createUpsertApi, type UpsertApi } from '../../index/upsert'
import { createIndexQueries, type IndexQueries } from '../../index/queries'
import { createZoteroConnector } from './index'
import type { ZoteroClient } from './client'

/**
 * Integration tier: the Zotero connector's mapping output driven through the REAL
 * write path — real better-sqlite3, real migrations, real FTS5 — using the same
 * fixtures the unit tests use, served by a fake client. Asserts documents +
 * annotations land, hash, and are FTS-searchable (the step-4 "personally usable"
 * DoD, mechanized).
 */
const FIXTURES = join(__dirname, '__fixtures__')
const rawItems = JSON.parse(readFileSync(join(FIXTURES, 'items.json'), 'utf8')) as {
  data: { key: string; itemType: string; parentItem?: string; filename?: string; linkMode?: string }
}[]
const rawCollections = JSON.parse(readFileSync(join(FIXTURES, 'collections.json'), 'utf8')) as unknown[]

/** A client that serves the fixtures; `changedSince` overridable for the incremental path. */
function fakeClient(over: Partial<ZoteroClient> = {}): ZoteroClient {
  return {
    checkAvailable: async () => true,
    fetchItemsPage: async () => ({ items: rawItems as never, totalResults: rawItems.length, libraryVersion: 3691 }),
    fetchAllItems: async () => ({ items: rawItems as never, libraryVersion: 3691 }),
    countChangedSince: async () => ({ changed: rawItems.length, libraryVersion: 3691 }),
    fetchCollections: async () => rawCollections as never,
    ...over,
  }
}

let dir: string
let dataDir: string
let handle: DbHandle
let upsert: UpsertApi
let queries: IndexQueries

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'astrolabe-zotero-'))
  dataDir = mkdtempSync(join(tmpdir(), 'astrolabe-zdata-'))
  // Materialize each stored attachment as a small file so path resolution + hashing
  // are exercised without touching the user's real ~/Zotero.
  for (const it of rawItems) {
    const d = it.data
    if (d.itemType === 'attachment' && d.filename && d.linkMode === 'imported_file') {
      const filePath = join(dataDir, 'storage', d.key, d.filename)
      mkdirSync(dirname(filePath), { recursive: true })
      writeFileSync(filePath, `pdf-bytes-for-${d.key}`)
    }
  }
  handle = openDb(join(dir, 'index.db'))
  upsert = createUpsertApi(handle.db)
  queries = createIndexQueries(handle.db)
})
afterAll(() => {
  handle.close()
  rmSync(dir, { recursive: true, force: true })
  rmSync(dataDir, { recursive: true, force: true })
})
beforeEach(() => upsert.wipeDerived())

describe('zotero connector scan → index', () => {
  it('lands documents, collections, tags and annotations; cursor is the library version', async () => {
    const connector = createZoteroConnector({ client: fakeClient(), dataDir })
    const result = await connector.scan({ db: handle.db, upsert, cursor: null })

    expect(result.documentsUpserted).toBe(3) // journalArticle, top-level attachment, book
    expect(result.annotationsUpserted).toBe(2) // both under the Bishop attachment
    expect(result.cursor).toBe('3691')
  })

  it('annotation text is FTS-searchable with a snippet (the DoD query)', async () => {
    const connector = createZoteroConnector({ client: fakeClient(), dataDir })
    await connector.scan({ db: handle.db, upsert, cursor: null })

    const hits = queries.search({ q: 'precision' })
    expect(hits).toHaveLength(1)
    expect(hits[0]?.snippet).toContain('precision')
    expect(hits[0]?.instances[0]?.uri).toBe('zotero://select/library/items/VSVGJBTT')
    expect(hits[0]?.instances[0]?.filePath).toContain('storage/VSVGJBTT/')
  })

  it('titles are FTS-searchable and tags/collections attach to the document', async () => {
    const connector = createZoteroConnector({ client: fakeClient(), dataDir })
    await connector.scan({ db: handle.db, upsert, cursor: null })

    const hits = queries.search({ q: 'Electrocardiogram' })
    expect(hits.some((h) => h.tags.includes('model') && h.tags.includes('printed'))).toBe(true)
  })

  it('hashes resolved PDFs so the cross-source join can fire', async () => {
    const connector = createZoteroConnector({ client: fakeClient(), dataDir })
    await connector.scan({ db: handle.db, upsert, cursor: null })

    // Every PDF-kind document with a real file on disk gets a content hash.
    const hits = queries.search({ q: 'Electrocardiogram' })
    const doc = hits[0]
    expect(doc).toBeDefined()
    const row = handle.sqlite
      .prepare('SELECT content_sha256 FROM documents WHERE id = ?')
      .get(doc!.documentId) as { content_sha256: string | null }
    expect(row.content_sha256).toMatch(/^[0-9a-f]{64}$/)
  })

  it('is idempotent: scanning twice does not duplicate rows', async () => {
    const connector = createZoteroConnector({ client: fakeClient(), dataDir })
    await connector.scan({ db: handle.db, upsert, cursor: null })
    await connector.scan({ db: handle.db, upsert, cursor: null })
    expect(queries.search({ q: 'precision' })).toHaveLength(1)
  })

  it('incremental early-out: unchanged since cursor → no work, cursor advances to library version', async () => {
    const connector = createZoteroConnector({
      client: fakeClient({ countChangedSince: async () => ({ changed: 0, libraryVersion: 3700 }) }),
      dataDir,
    })
    const result = await connector.scan({ db: handle.db, upsert, cursor: '3691' })
    expect(result.documentsUpserted).toBe(0)
    expect(result.annotationsUpserted).toBe(0)
    expect(result.cursor).toBe('3700')
    expect(queries.search({ q: 'precision' })).toHaveLength(0) // nothing was written
  })
})
