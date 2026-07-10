import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, type DbHandle } from '../db'
import { createUpsertApi, type UpsertApi } from './upsert'
import { createIndexQueries, type IndexQueries } from './queries'

/**
 * Tier A integration: the index write path against real SQLite + real migrations.
 * Idempotency, the hash join, tags M:N, annotation upsert, FTS lifecycle, wipe.
 */
let dir: string
let handle: DbHandle
let upsert: UpsertApi
let queries: IndexQueries

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'astrolabe-upsert-'))
  handle = openDb(join(dir, 'index.db'))
  upsert = createUpsertApi(handle.db)
  queries = createIndexQueries(handle.db)
})
afterAll(() => {
  handle.close()
  rmSync(dir, { recursive: true, force: true })
})
beforeEach(() => upsert.wipeDerived())

const zoteroDoc = (over: Record<string, unknown> = {}) => ({
  sourceKey: 'zotero',
  externalKey: 'ABC123',
  uri: 'zotero://select/library/items/ABC123',
  title: 'Probabilistic Machine Learning',
  kind: 'pdf' as const,
  contentSha256: 'hash-murphy',
  modifiedAt: 1000,
  tags: ['ml', 'textbook'],
  annotations: [
    { externalKey: 'ANN1', type: 'highlight', text: 'precision and recall tradeoff', pageLabel: '148', modifiedAt: 1000 },
  ],
  ...over,
})

describe('upsertDocument', () => {
  it('is idempotent: same payload twice → one document, one instance, one annotation', () => {
    const first = upsert.upsertDocument(zoteroDoc())
    const second = upsert.upsertDocument(zoteroDoc())
    expect(second.documentId).toBe(first.documentId)
    expect(second.instanceId).toBe(first.instanceId)
    const hits = queries.search({ q: 'probabilistic' })
    expect(hits).toHaveLength(1)
    expect(hits[0]?.instances).toHaveLength(1)
  })

  it('HASH JOIN: same contentSha256 from two sources → one document, two instances', () => {
    const z = upsert.upsertDocument(zoteroDoc())
    const e = upsert.upsertDocument(
      zoteroDoc({
        sourceKey: 'eagle',
        externalKey: 'MQG0GMKZ',
        uri: 'eagle://item/MQG0GMKZ',
        title: 'Murphy ProbabilisticMachineLearning',
        annotations: undefined,
        tags: ['reference'],
      }),
    )
    expect(e.documentId).toBe(z.documentId)
    const hits = queries.search({ q: 'probabilistic' })
    expect(hits).toHaveLength(1)
    expect(hits[0]?.instances.map((i) => i.sourceKey).sort()).toEqual(['eagle', 'zotero'])
    // tags from both sources merge on the one document
    expect(hits[0]?.tags.sort()).toEqual(['ml', 'reference', 'textbook'])
  })

  it('no hash → separate documents', () => {
    const a = upsert.upsertDocument(zoteroDoc({ contentSha256: null }))
    const b = upsert.upsertDocument(
      zoteroDoc({ sourceKey: 'eagle', externalKey: 'X', uri: 'eagle://item/X', contentSha256: null }),
    )
    expect(b.documentId).not.toBe(a.documentId)
  })

  it('annotation upsert updates in place (no duplicates), searchable via FTS body', () => {
    upsert.upsertDocument(zoteroDoc())
    upsert.upsertDocument(
      zoteroDoc({
        annotations: [
          { externalKey: 'ANN1', type: 'highlight', text: 'REVISED text about hyperplanes', pageLabel: '148', modifiedAt: 2000 },
        ],
      }),
    )
    const hits = queries.search({ q: 'hyperplanes' })
    expect(hits).toHaveLength(1)
    expect(queries.search({ q: 'precision' })).toHaveLength(0) // old body gone
  })

  it('collections upsert with parent resolution regardless of order', () => {
    upsert.upsertCollections('eagle', [
      { externalKey: 'child', name: 'Papers', parentExternalKey: 'root' },
      { externalKey: 'root', name: 'Library' },
    ])
    upsert.upsertDocument(zoteroDoc({ sourceKey: 'eagle', collectionKeys: ['child'], externalKey: 'E1', uri: 'eagle://item/E1' }))
    // re-upsert same tree — idempotent
    upsert.upsertCollections('eagle', [
      { externalKey: 'child', name: 'Papers', parentExternalKey: 'root' },
      { externalKey: 'root', name: 'Library' },
    ])
  })

  it('wipeDerived empties search and cursors (rebuild law)', () => {
    upsert.upsertDocument(zoteroDoc())
    expect(queries.search({ q: 'probabilistic' })).toHaveLength(1)
    upsert.wipeDerived()
    expect(queries.search({ q: 'probabilistic' })).toHaveLength(0)
  })
})
