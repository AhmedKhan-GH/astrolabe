import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, type DbHandle } from '../db'
import { createUpsertApi, type UpsertApi } from './upsert'
import { reconcileRemovals } from './removals'
import { createIndexQueries, type IndexQueries } from './queries'

/**
 * Tier A integration: the v2 read path — FTS search, filtered browse, the
 * ghost toggle (D3: hidden by default, one switch reveals), the libraries
 * snapshot, and stats. Real SQLite, real migrations (incl. 0001_fts).
 */
let dir: string
let handle: DbHandle
let upsert: UpsertApi
let queries: IndexQueries

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'astrolabe-queries-'))
  handle = openDb(join(dir, 'index.db'))
  upsert = createUpsertApi(handle.db)
  queries = createIndexQueries(handle.db)
})
afterAll(() => {
  handle.close()
  rmSync(dir, { recursive: true, force: true })
})
beforeEach(() => upsert.wipeDerived())

const lib = (connector: string, stableKey: string) =>
  upsert.ensureLibrary(connector, stableKey, `${connector}:${stableKey}`)

const put = (libraryId: number, over: Record<string, unknown> = {}) =>
  upsert.upsertDocument({
    libraryId,
    externalKey: 'ABC123',
    uri: 'zotero://select/library/items/ABC123',
    title: 'Probabilistic Machine Learning',
    kind: 'pdf',
    contentSha256: 'hash-murphy',
    modifiedAt: 1000,
    tags: ['ml', 'textbook'],
    annotations: [
      {
        externalKey: 'ANN1',
        type: 'highlight',
        text: 'precision and recall tradeoff',
        pageLabel: '148',
        modifiedAt: 1000,
      },
    ],
    ...over,
  })

describe('search — FTS5 over title/body/tags', () => {
  it('matches title, ranks, snippets; hydrates instances with library provenance', () => {
    const z = lib('zotero', '1')
    put(z.id)
    const hits = queries.search({ q: 'probabilistic' })
    expect(hits).toHaveLength(1)
    expect(hits[0]?.title).toBe('Probabilistic Machine Learning')
    expect(hits[0]?.instances).toHaveLength(1)
    expect(hits[0]?.instances[0]?.connectorKey).toBe('zotero')
    expect(hits[0]?.instances[0]?.libraryName).toBe('zotero:1')
  })

  it('matches annotation body text', () => {
    const z = lib('zotero', '1')
    put(z.id)
    expect(queries.search({ q: 'tradeoff' })).toHaveLength(1)
  })

  it('annotation revision replaces the FTS body (old text unfindable)', () => {
    const z = lib('zotero', '1')
    put(z.id)
    put(z.id, {
      annotations: [
        {
          externalKey: 'ANN1',
          type: 'highlight',
          text: 'REVISED text about hyperplanes',
          pageLabel: '148',
          modifiedAt: 2000,
        },
      ],
    })
    expect(queries.search({ q: 'hyperplanes' })).toHaveLength(1)
    expect(queries.search({ q: 'precision' })).toHaveLength(0)
  })

  it('ghosts are hidden from search by default; includeGhosts reveals (D3)', () => {
    const z = lib('zotero', '1')
    put(z.id)
    reconcileRemovals(handle.db, z.id, []) // sole copy gone → ghost
    expect(queries.search({ q: 'probabilistic' })).toHaveLength(0)
    const revealed = queries.search({ q: 'probabilistic', includeGhosts: true })
    expect(revealed).toHaveLength(1)
    expect(revealed[0]?.instances).toHaveLength(0)
  })
})

describe('browse — the filtered recency river', () => {
  it('pages newest-first with a total that drives the virtualizer', () => {
    const z = lib('zotero', '1')
    put(z.id, { externalKey: 'A', contentSha256: 'h-a', title: 'Older', modifiedAt: 100 })
    put(z.id, { externalKey: 'B', contentSha256: 'h-b', title: 'Newer', modifiedAt: 200 })
    const page = queries.browse({ limit: 1 })
    expect(page.total).toBe(2)
    expect(page.hits[0]?.title).toBe('Newer')
    const page2 = queries.browse({ limit: 1, offset: 1 })
    expect(page2.hits[0]?.title).toBe('Older')
  })

  it('filters: kind, tags (ALL/ANY/NONE), connector, and libraryIds', () => {
    const personal = lib('zotero', '1')
    const group = lib('zotero', 'group:7')
    put(personal.id, { externalKey: 'P', contentSha256: 'h-p', tags: ['ml', 'deep'] })
    put(group.id, { externalKey: 'G', contentSha256: 'h-g', title: 'Group Doc', tags: ['ml'], kind: 'note' })

    expect(queries.browse({ kinds: ['note'] }).total).toBe(1)
    expect(queries.browse({ tagsAll: ['ml', 'deep'] }).total).toBe(1)
    expect(queries.browse({ tagsAny: ['ml'] }).total).toBe(2)
    expect(queries.browse({ tagsNone: ['deep'] }).total).toBe(1)
    expect(queries.browse({ connectorKeys: ['zotero'] }).total).toBe(2)
    expect(queries.browse({ libraryIds: [group.id] }).total).toBe(1)
    expect(queries.browse({ libraryIds: [group.id] }).hits[0]?.title).toBe('Group Doc')
  })

  it('ghosts hidden by default, counted and revealed by the one toggle (D3)', () => {
    const z = lib('zotero', '1')
    put(z.id, { externalKey: 'K', contentSha256: 'h-k', title: 'Keeper' })
    put(z.id, { externalKey: 'G', contentSha256: 'h-g', title: 'Goner' })
    reconcileRemovals(handle.db, z.id, ['K'])

    const hidden = queries.browse({})
    expect(hidden.total).toBe(1)
    expect(hidden.hits[0]?.title).toBe('Keeper')
    const revealed = queries.browse({ includeGhosts: true })
    expect(revealed.total).toBe(2)
  })
})

describe('librariesSnapshot + stats', () => {
  it('reports connectors, per-library counts and availability', () => {
    const personal = lib('zotero', '1')
    const group = lib('zotero', 'group:7')
    put(personal.id, { externalKey: 'P', contentSha256: 'h-p' })
    put(personal.id, { externalKey: 'P2', contentSha256: 'h-p2' })
    put(group.id, { externalKey: 'G', contentSha256: 'h-g' })

    const snap = queries.librariesSnapshot()
    expect(snap.connectors.map((c) => c.key)).toEqual(['zotero'])
    expect(snap.libraries).toHaveLength(2)
    const p = snap.libraries.find((l) => l.stableKey === '1')
    const g = snap.libraries.find((l) => l.stableKey === 'group:7')
    expect(p?.documentCount).toBe(2)
    expect(g?.documentCount).toBe(1)
    expect(p?.availability).toBe('live')
  })

  it('stats: documents, annotations, ghosts', () => {
    const z = lib('zotero', '1')
    put(z.id, { externalKey: 'A', contentSha256: 'h-a' })
    put(z.id, { externalKey: 'B', contentSha256: 'h-b', annotations: undefined })
    reconcileRemovals(handle.db, z.id, ['A'])
    const stats = queries.indexStats()
    expect(stats.documents).toBe(2)
    expect(stats.ghosts).toBe(1)
    expect(stats.annotations).toBe(1)
  })
})
