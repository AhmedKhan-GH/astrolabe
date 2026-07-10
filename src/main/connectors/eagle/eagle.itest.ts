import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, type DbHandle } from '../../db'
import { createUpsertApi, type UpsertApi } from '../../index/upsert'
import { createIndexQueries, type IndexQueries } from '../../index/queries'
import { sha256File } from '../../lib/hash'
import type { SyncContext } from '../types'
import type { EagleClient } from './client'
import { createEagleConnector } from './index'

/**
 * Tier A integration: the Eagle connector against real SQLite + real migrations + real
 * files on disk. The money assertion is the hash join — a PDF held in BOTH Zotero and
 * Eagle must collapse to ONE document with TWO instances. We drive the FULL scan through
 * a fake client (fixtures point at temp files we create + hash for real).
 *
 * Real files live under <lib>/images/<id>.info/<name>.<ext> — mapping.resolveFilePath
 * computes exactly that path, so writing the byte content there makes sha256File in scan
 * produce a genuine hash (the same layout Eagle uses in production).
 */
let dir: string
let libraryPath: string
let handle: DbHandle
let upsert: UpsertApi
let queries: IndexQueries

/** Write byte content to the on-disk layout Eagle uses; returns the absolute file path. */
function writeItemFile(id: string, name: string, ext: string, content: string): string {
  const infoDir = join(libraryPath, 'images', `${id}.info`)
  mkdirSync(infoDir, { recursive: true })
  const filePath = join(infoDir, `${name}.${ext}`)
  writeFileSync(filePath, content)
  return filePath
}

/** A fake EagleClient serving a fixed folder tree + one page of items. */
function fakeClient(folders: unknown[], items: unknown[]): EagleClient {
  return {
    applicationInfo: async () => ({ version: '4.0.0' }),
    libraryInfo: async () => ({ path: libraryPath, folders }),
    itemList: async ({ page }) => (page === 0 ? items : []),
    folderList: async () => folders,
  }
}

function ctx(cursor: string | null): SyncContext {
  return { db: handle.db, upsert, cursor }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'astrolabe-eagle-'))
  libraryPath = join(dir, 'Books.library')
  handle = openDb(join(dir, 'index.db'))
  upsert = createUpsertApi(handle.db)
  queries = createIndexQueries(handle.db)
})
afterEach(() => {
  handle.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('eagle scan — items land', () => {
  it('upserts folders (nested), items, tags, and folder membership', async () => {
    writeItemFile('E1', 'griffiths', 'pdf', 'griffiths quantum content')
    const folders = [
      { id: 'ROOT', name: 'Courses', children: [{ id: 'SUB', name: 'Griffiths', children: [] }] },
    ]
    const items = [
      { id: 'E1', name: 'griffiths', ext: 'pdf', tags: ['quantum', 'science'], folders: ['SUB'], isDeleted: false, modificationTime: 1000 },
    ]
    const conn = createEagleConnector(fakeClient(folders, items))

    const result = await conn.scan(ctx(null))

    expect(result.documentsUpserted).toBe(1)
    expect(result.cursor).toBe('1000')
    const hits = queries.search({ q: 'griffiths' })
    expect(hits).toHaveLength(1)
    expect(hits[0]?.kind).toBe('pdf')
    expect(hits[0]?.tags.sort()).toEqual(['quantum', 'science'])
    expect(hits[0]?.instances[0]?.uri).toBe('eagle://item/E1')
  })

  it('skips deleted rows and does not hash a bookmark with no ext', async () => {
    const items = [
      { id: 'LINK', name: 'ARM ref', tags: [], folders: [], url: 'https://developer.arm.com', isDeleted: false, modificationTime: 500 },
      { id: 'TRASH', name: 'gone', ext: 'pdf', tags: [], folders: [], isDeleted: true, modificationTime: 400 },
    ]
    const conn = createEagleConnector(fakeClient([], items))
    const result = await conn.scan(ctx(null))
    expect(result.documentsUpserted).toBe(1) // only the bookmark; trash excluded
  })
})

describe('eagle scan — THE HASH JOIN (Zotero↔Eagle, the money logic)', () => {
  it('same PDF in Zotero and Eagle → ONE document, TWO instances, tags merged', async () => {
    // 1. A real file on disk at Eagle's layout; hash it for real.
    const filePath = writeItemFile('MQG0GMKZ', 'Murphy ProbabilisticML', 'pdf', 'the exact bytes of murphy pml')
    const sha = await sha256File(filePath)
    expect(sha).toBeTruthy()

    // 2. Zotero already holds the same file (same contentSha256) — seed it directly.
    upsert.upsertDocument({
      sourceKey: 'zotero',
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
    const conn = createEagleConnector(fakeClient([], items))
    await conn.scan(ctx(null))

    // 4. ONE document, TWO provenance instances, tags from both sources merged.
    const hits = queries.search({ q: 'probabilistic' })
    expect(hits).toHaveLength(1)
    expect(hits[0]?.instances.map((i) => i.sourceKey).sort()).toEqual(['eagle', 'zotero'])
    expect(hits[0]?.tags.sort()).toEqual(['ml', 'reference', 'textbook'])
  })

  it('different bytes → no join (two separate documents)', async () => {
    const zFile = writeItemFile('Z1', 'zoterocopy', 'pdf', 'zotero bytes')
    const zSha = await sha256File(zFile)
    upsert.upsertDocument({
      sourceKey: 'zotero', externalKey: 'Z1', uri: 'zotero://z1', title: 'ZoteroOnlyPaper',
      kind: 'pdf', contentSha256: zSha, modifiedAt: 900,
    })
    writeItemFile('E9', 'eaglecopy', 'pdf', 'entirely different eagle bytes')
    const items = [{ id: 'E9', name: 'EagleOnlyPaper', ext: 'pdf', tags: [], folders: [], isDeleted: false, modificationTime: 1000 }]
    await createEagleConnector(fakeClient([], items)).scan(ctx(null))

    // Two distinct documents (title indexes both).
    const zHits = queries.search({ q: 'ZoteroOnlyPaper' })
    const eHits = queries.search({ q: 'EagleOnlyPaper' })
    expect(zHits).toHaveLength(1)
    expect(eHits).toHaveLength(1)
    expect(zHits[0]?.documentId).not.toBe(eHits[0]?.documentId)
  })
})

describe('eagle scan — incremental watermark cursor', () => {
  it('skips items with modificationTime ≤ cursor, advances cursor to the new max', async () => {
    writeItemFile('OLD', 'old-doc', 'pdf', 'old')
    writeItemFile('NEW', 'new-doc', 'pdf', 'new')
    const items = [
      { id: 'OLD', name: 'old-doc', ext: 'pdf', tags: [], folders: [], isDeleted: false, modificationTime: 1000 },
      { id: 'NEW', name: 'new-doc', ext: 'pdf', tags: [], folders: [], isDeleted: false, modificationTime: 2000 },
    ]
    const conn = createEagleConnector(fakeClient([], items))

    // Second incremental scan from cursor 1000: only NEW (2000 > 1000) is re-upserted.
    const result = await conn.scan(ctx('1000'))
    expect(result.documentsUpserted).toBe(1)
    expect(result.cursor).toBe('2000')
  })
})
