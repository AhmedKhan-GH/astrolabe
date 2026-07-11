import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../main/db'
import { createUpsertApi } from '../main/index/upsert'
import { resolveLinks } from '../main/index/links'
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
let alphaId: number
let betaId: number

const OPEN_PDF_URI = 'zotero://open-pdf/library/items/VSVGJBTT?page=148'
// A path that MUST NOT appear in any agent-facing tool output (agents have no fs access).
const SECRET_PATH = '/Users/ahmed/secret/murphy.pdf'

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
    filePath: SECRET_PATH,
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
        // Carries the openPdfUri (top-level, for get_annotations) AND a $.position.pageIndex
        // (for get_page_annotations' per-page heat).
        positionJson: JSON.stringify({
          attachmentKey: 'VSVGJBTT',
          openPdfUri: OPEN_PDF_URI,
          position: { pageIndex: 147 },
        }),
        modifiedAt: 1000,
      },
    ],
  })
  documentId = res.documentId

  // Two Obsidian notes wired by a wiki-link: Alpha → Beta (for get_links).
  betaId = upsert.upsertDocument({
    sourceKey: 'obsidian',
    externalKey: 'Beta.md',
    uri: 'obsidian://open?file=Beta.md',
    title: 'Beta',
    kind: 'note',
    modifiedAt: 2000,
    links: [],
  }).documentId
  alphaId = upsert.upsertDocument({
    sourceKey: 'obsidian',
    externalKey: 'Alpha.md',
    uri: 'obsidian://open?file=Alpha.md',
    title: 'Alpha',
    kind: 'note',
    modifiedAt: 3000,
    links: ['Beta'],
  }).documentId
  resolveLinks(writeHandle.db) // resolve wiki-link targets, as the app does post-sync
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

  it('search_library finds seeded content with provenance (no filePath)', () => {
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
        openPdfUri: null,
      },
    ])
    expect(hit.instances[0]).not.toHaveProperty('filePath')
    expect(hit.documentId).toBe(documentId)
  })

  it('search_library respects limit and returns [] on no match', () => {
    expect(handlers.searchLibrary({ q: 'thereisnosuchtoken' })).toEqual([])
  })

  it('browse_library returns compact newest-first hits (sources, no instances/paths)', () => {
    const page = handlers.browseLibrary({})
    expect(page.total).toBe(3)
    expect(page.hits.map((h) => h.title)).toEqual([
      'Alpha',
      'Beta',
      'Probabilistic Machine Learning',
    ])
    const zhit = page.hits.find((h) => h.title.startsWith('Probabilistic'))!
    expect(zhit.documentId).toBe(documentId)
    expect(zhit.kind).toBe('pdf')
    expect(zhit.sources).toEqual(['zotero'])
    expect(zhit.tags).toEqual(expect.arrayContaining(['ml', 'textbook']))
    expect(zhit).not.toHaveProperty('instances')
    expect(zhit).not.toHaveProperty('filePath')
  })

  it('browse_library passes the filter set through', () => {
    expect(handlers.browseLibrary({ sourceKeys: ['zotero'] }).total).toBe(1)
    expect(handlers.browseLibrary({ kinds: ['note'] }).total).toBe(2)
    expect(handlers.browseLibrary({ sourceKeys: ['zotero'] }).hits.map((h) => h.documentId)).toEqual([
      documentId,
    ])
    expect(handlers.browseLibrary({ tagsAll: ['ml'] }).hits.map((h) => h.documentId)).toEqual([
      documentId,
    ])
  })

  it('browse_library caps limit at 50 (rejects a larger page)', () => {
    expect(() => handlers.browseLibrary({ limit: 51 })).toThrow()
  })

  it('get_document returns the full DocumentDetail without file paths', () => {
    const d = handlers.getDocument({ documentId })
    expect(d.documentId).toBe(documentId)
    expect(d.title).toBe('Probabilistic Machine Learning')
    expect(d.kind).toBe('pdf')
    expect(d.tags).toEqual(expect.arrayContaining(['ml', 'textbook']))
    expect(d.instances).toEqual([
      {
        instanceId: expect.any(Number),
        sourceKey: 'zotero',
        uri: 'zotero://select/library/items/ABC123',
        openPdfUri: null,
      },
    ])
    expect(d.annotations.total).toBe(1)
    expect(d.annotations.pages).toEqual([{ pageIndex: 147, count: 1 }])
    expect(d.presence).toBe('zotero-only')
    expect(d.virtualCollections).toEqual([])
    expect(d.backlinks).toEqual([])
    expect(JSON.stringify(d)).not.toContain('filePath')
  })

  it('get_document throws a not-found error for an unknown id', () => {
    expect(() => handlers.getDocument({ documentId: 999999 })).toThrow(/not found/i)
  })

  it('get_links returns the wiki-link graph (outlinks + backlinks)', () => {
    const alpha = handlers.getLinks({ documentId: alphaId })
    expect(alpha.outlinks).toHaveLength(1)
    expect(alpha.outlinks[0]).toMatchObject({
      targetName: 'Beta',
      documentId: betaId,
      title: 'Beta',
      kind: 'note',
    })
    expect(alpha.backlinks).toEqual([])

    const beta = handlers.getLinks({ documentId: betaId })
    expect(beta.outlinks).toEqual([])
    expect(beta.backlinks).toHaveLength(1)
    expect(beta.backlinks[0]).toMatchObject({ documentId: alphaId, title: 'Alpha', kind: 'note' })
  })

  it('get_page_annotations returns per-page annotation counts', () => {
    const pa = handlers.getPageAnnotations({ documentId })
    expect(pa.pages).toEqual([{ pageIndex: 147, count: 1 }])
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

  it('list_overview returns trimmed nav facets (no trees, no paths)', () => {
    const o = handlers.listOverview()
    expect(o.kinds).toEqual(
      expect.arrayContaining([
        { kind: 'pdf', count: 1 },
        { kind: 'note', count: 2 },
      ]),
    )
    const zsrc = o.sources.find((s) => s.key === 'zotero')!
    expect(zsrc).toEqual({ key: 'zotero', status: expect.any(String), documentCount: 1 })
    expect(o.sources.every((src) => !('tree' in src))).toBe(true)
    expect(o.tags.length).toBeLessThanOrEqual(50)
    expect(o.tags).toEqual(
      expect.arrayContaining([
        { name: 'ml', count: 1 },
        { name: 'textbook', count: 1 },
      ]),
    )
    expect(o.presence).toEqual([
      { value: 'both', count: 0 },
      { value: 'zotero-only', count: 1 },
      { value: 'eagle-only', count: 0 },
    ])
  })

  it('no tool output leaks a filesystem path', () => {
    const outputs = [
      handlers.searchLibrary({ q: 'precision' }),
      handlers.browseLibrary({}),
      handlers.getDocument({ documentId }),
      handlers.getAnnotations({ documentId }),
      handlers.getPageAnnotations({ documentId }),
      handlers.getLinks({ documentId: alphaId }),
      handlers.listSources(),
      handlers.listOverview(),
    ]
    const blob = JSON.stringify(outputs)
    expect(blob).not.toContain('filePath')
    expect(blob).not.toContain(SECRET_PATH)
    expect(blob).not.toContain('/Users/')
  })

  it('rejects malformed input at the zod boundary', () => {
    expect(() => handlers.getDocument({ documentId: -1 })).toThrow()
    expect(() => handlers.searchLibrary({ q: '' })).toThrow()
    expect(() => handlers.browseLibrary({ sourceKeys: ['nope'] })).toThrow()
  })
})
