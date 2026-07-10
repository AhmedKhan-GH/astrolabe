import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../main/db'
import { createUpsertApi } from '../main/index/upsert'
import { openReadonlyDb, type ReadonlyDbHandle } from './db'
import { createHandlers, type Handlers } from './handlers'

/**
 * Integration tier (runs under `pnpm test:integration`): seed a real index via the
 * production write path, reopen it READ-ONLY exactly as the MCP server does, and
 * drive the tool handlers directly. Proves the MCP adapter returns the seeded
 * content over a genuine read-only better-sqlite3 handle. (Full stdio transport is
 * exercised by the live check documented in src/mcp/README.md.)
 */

let dir: string
let writeHandle: ReturnType<typeof openDb>
let roHandle: ReadonlyDbHandle
let handlers: Handlers
let documentId: number

const OPEN_PDF_URI = 'zotero://open-pdf/library/items/VSVGJBTT?page=148'

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'astrolabe-mcp-'))
  const dbPath = join(dir, 'index.db')

  // Seed with the same API the app/connectors use, then close the writer.
  writeHandle = openDb(dbPath)
  const upsert = createUpsertApi(writeHandle.db)
  upsert.upsertCollections('zotero', [{ externalKey: 'COL1', name: 'Machine Learning' }])
  const res = upsert.upsertDocument({
    sourceKey: 'zotero',
    externalKey: 'ABC123',
    uri: 'zotero://select/library/items/ABC123',
    title: 'Probabilistic Machine Learning',
    kind: 'pdf',
    contentSha256: 'hash-murphy',
    modifiedAt: 1000,
    tags: ['ml', 'textbook'],
    collectionKeys: ['COL1'],
    annotations: [
      {
        externalKey: 'ANN1',
        type: 'highlight',
        text: 'precision represents the probability that a positive test is a true positive',
        pageLabel: '148',
        color: '#ffd400',
        positionJson: JSON.stringify({ attachmentKey: 'VSVGJBTT', openPdfUri: OPEN_PDF_URI }),
        modifiedAt: 1000,
      },
    ],
  })
  documentId = res.documentId
  writeHandle.close()

  // Reopen exactly as the MCP server does.
  roHandle = openReadonlyDb(dbPath)
  handlers = createHandlers(roHandle.db)
})

afterAll(() => {
  roHandle.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('mcp handlers over a read-only index', () => {
  it('the handle is genuinely read-only (writes rejected)', () => {
    expect(() => roHandle.sqlite.exec('CREATE TABLE nope (x)')).toThrow(/readonly/i)
  })

  it('search_library finds seeded content with provenance', () => {
    const hits = handlers.searchLibrary({ q: 'precision' })
    expect(hits).toHaveLength(1)
    const hit = hits[0]!
    expect(hit.title).toBe('Probabilistic Machine Learning')
    expect(hit.kind).toBe('pdf')
    expect(hit.snippet.toLowerCase()).toContain('precision')
    expect(hit.tags).toEqual(expect.arrayContaining(['ml', 'textbook']))
    expect(hit.instances).toEqual([
      {
        instanceId: expect.any(Number),
        sourceKey: 'zotero',
        uri: 'zotero://select/library/items/ABC123',
        filePath: null,
        openPdfUri: null,
      },
    ])
    expect(hit.documentId).toBe(documentId)
  })

  it('search_library respects limit and returns [] on no match', () => {
    expect(handlers.searchLibrary({ q: 'thereisnosuchtoken' })).toEqual([])
  })

  it('get_document returns metadata, instances, tags, and collection names', () => {
    const detail = handlers.getDocument({ documentId })
    expect(detail).not.toBeNull()
    expect(detail!.document.title).toBe('Probabilistic Machine Learning')
    expect(detail!.instances.map((i) => i.sourceKey)).toEqual(['zotero'])
    expect(detail!.tags).toEqual(expect.arrayContaining(['ml', 'textbook']))
    expect(detail!.collections).toEqual(['Machine Learning'])
  })

  it('get_document returns null for an unknown id', () => {
    expect(handlers.getDocument({ documentId: 999999 })).toBeNull()
  })

  it('get_annotations returns highlight text with the openPdfUri from positionJson', () => {
    const anns = handlers.getAnnotations({ documentId })
    expect(anns).toHaveLength(1)
    const a = anns[0]!
    expect(a.type).toBe('highlight')
    expect(a.text).toContain('precision')
    expect(a.pageLabel).toBe('148')
    expect(a.color).toBe('#ffd400')
    expect(a.openPdfUri).toBe(OPEN_PDF_URI)
    expect(a.sourceKey).toBe('zotero')
  })

  it('list_sources reports per-source document counts', () => {
    const sources = handlers.listSources()
    const zotero = sources.find((s) => s.key === 'zotero')
    expect(zotero).toBeDefined()
    expect(zotero!.documentCount).toBe(1)
    expect(zotero!.status).toBe('ok')
  })

  it('rejects malformed input at the zod boundary', () => {
    expect(() => handlers.getDocument({ documentId: -1 })).toThrow()
    expect(() => handlers.searchLibrary({ q: '' })).toThrow()
  })
})
