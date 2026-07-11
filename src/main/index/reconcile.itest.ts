import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, type DbHandle } from '../db'
import { createUpsertApi, type UpsertApi } from './upsert'
import { createIndexQueries, type IndexQueries } from './queries'
import { createReconcileApi } from './reconcile'
import type { ZoteroWrite } from '../lib/zotero-write'
import type { EagleWrite } from '../lib/eagle-write'

/**
 * Handler-flow integration for the Eagle↔Zotero gate (spec §Testing → Integration): the gate against
 * REAL SQLite with mocked write clients. The gates fire BEFORE any network call; the success path
 * dispatches to the right client and marks nothing in OUR db directly (the target sync does that).
 */
let dir: string
let handle: DbHandle
let upsert: UpsertApi
let queries: IndexQueries

const docIdByTitle = (title: string): number => {
  // one document row per title in these fixtures
  const hit = queries.browse({}).hits.find((h) => h.title === title)!
  return hit.documentId
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'astrolabe-reconcile-'))
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
  // eagle-only pdf with a file on disk → promotable to zotero
  upsert.upsertDocument({ sourceKey: 'eagle', externalKey: 'E1', uri: 'eagle://E1', title: 'Eagle Only PDF', kind: 'pdf', filePath: '/lib/e1.pdf', contentSha256: 'he1', modifiedAt: 100 })
  // zotero-only pdf with a file on disk → importable to eagle
  upsert.upsertDocument({ sourceKey: 'zotero', externalKey: 'Z1', uri: 'zotero://select/library/items/Z1', title: 'Zotero Only PDF', kind: 'pdf', filePath: '/z/z1.pdf', contentSha256: 'hz1', modifiedAt: 200 })
  // both: same content hash across sources → one joined document
  upsert.upsertDocument({ sourceKey: 'eagle', externalKey: 'E2', uri: 'eagle://E2', title: 'Shared PDF', kind: 'pdf', filePath: '/lib/e2.pdf', contentSha256: 'shared', modifiedAt: 300 })
  upsert.upsertDocument({ sourceKey: 'zotero', externalKey: 'Z2', uri: 'zotero://select/library/items/Z2', title: 'Shared PDF', kind: 'pdf', filePath: '/z/z2.pdf', contentSha256: 'shared', modifiedAt: 300 })
  // eagle-only NON-pdf
  upsert.upsertDocument({ sourceKey: 'eagle', externalKey: 'E3', uri: 'eagle://E3', title: 'Eagle Image', kind: 'image', filePath: '/lib/e3.png', contentSha256: 'he3', modifiedAt: 400 })
  // eagle-only pdf with NO file path
  upsert.upsertDocument({ sourceKey: 'eagle', externalKey: 'E4', uri: 'eagle://E4', title: 'No File PDF', kind: 'pdf', modifiedAt: 500 })
})

const mocks = () => {
  const promoteDocument = vi.fn(async () => ({ ok: true }) as const)
  const importDocument = vi.fn(async () => ({ ok: true }) as const)
  const api = createReconcileApi(handle.db, queries, {
    zoteroWrite: { promoteDocument } as unknown as ZoteroWrite,
    eagleWrite: { importDocument } as unknown as EagleWrite,
    fileExists: () => true,
  })
  return { api, promoteDocument, importDocument }
}

describe('reconcile transfer — success paths', () => {
  it('to-zotero promotes an eagle-only pdf with the doc title/tags/filePath', async () => {
    const { api, promoteDocument, importDocument } = mocks()
    const res = await api.transfer({ documentId: docIdByTitle('Eagle Only PDF'), direction: 'to-zotero' })
    expect(res).toEqual({ ok: true })
    expect(promoteDocument).toHaveBeenCalledWith({ title: 'Eagle Only PDF', tags: [], filePath: '/lib/e1.pdf' })
    expect(importDocument).not.toHaveBeenCalled()
  })

  it('to-eagle imports a zotero-only pdf with the zotero item key as the back-link', async () => {
    const { api, importDocument } = mocks()
    const res = await api.transfer({ documentId: docIdByTitle('Zotero Only PDF'), direction: 'to-eagle' })
    expect(res).toEqual({ ok: true })
    expect(importDocument).toHaveBeenCalledWith({
      title: 'Zotero Only PDF',
      tags: [],
      filePath: '/z/z1.pdf',
      externalKey: 'Z1',
    })
  })
})

describe('reconcile transfer — gate refusals (before any network call)', () => {
  it('refuses when the target already has it (already both)', async () => {
    const { api, promoteDocument, importDocument } = mocks()
    const id = docIdByTitle('Shared PDF')
    expect((await api.transfer({ documentId: id, direction: 'to-zotero' })).ok).toBe(false)
    expect((await api.transfer({ documentId: id, direction: 'to-eagle' })).ok).toBe(false)
    expect(promoteDocument).not.toHaveBeenCalled()
    expect(importDocument).not.toHaveBeenCalled()
  })

  it('refuses a non-pdf', async () => {
    const { api, promoteDocument } = mocks()
    const res = await api.transfer({ documentId: docIdByTitle('Eagle Image'), direction: 'to-zotero' })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toMatch(/only pdfs/i)
    expect(promoteDocument).not.toHaveBeenCalled()
  })

  it('refuses when the source has no file on disk (no filePath recorded)', async () => {
    const { api, promoteDocument } = mocks()
    const res = await api.transfer({ documentId: docIdByTitle('No File PDF'), direction: 'to-zotero' })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toMatch(/no file on disk/i)
    expect(promoteDocument).not.toHaveBeenCalled()
  })

  it('refuses when the recorded file is missing on disk (fileExists=false)', async () => {
    const promoteDocument = vi.fn(async () => ({ ok: true }) as const)
    const api = createReconcileApi(handle.db, queries, {
      zoteroWrite: { promoteDocument } as unknown as ZoteroWrite,
      eagleWrite: { importDocument: vi.fn() } as unknown as EagleWrite,
      fileExists: () => false,
    })
    const res = await api.transfer({ documentId: docIdByTitle('Eagle Only PDF'), direction: 'to-zotero' })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toMatch(/missing on disk/i)
    expect(promoteDocument).not.toHaveBeenCalled()
  })

  it('refuses an unknown document id', async () => {
    const { api } = mocks()
    const res = await api.transfer({ documentId: 999999, direction: 'to-zotero' })
    expect(res.ok).toBe(false)
  })

  it('refuses the wrong-direction request (no eagle copy to promote)', async () => {
    const { api, promoteDocument } = mocks()
    // Zotero-only doc asked to promote-to-zotero → no eagle source copy.
    const res = await api.transfer({ documentId: docIdByTitle('Zotero Only PDF'), direction: 'to-zotero' })
    expect(res.ok).toBe(false)
    expect(promoteDocument).not.toHaveBeenCalled()
  })
})
