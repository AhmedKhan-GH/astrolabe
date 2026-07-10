import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { and, eq } from 'drizzle-orm'
import { openDb, type DbHandle } from '../db'
import * as s from '../db/schema'
import { createUpsertApi, type UpsertApi } from './upsert'
import { createIndexQueries, type IndexQueries } from './queries'

/**
 * Tier A integration for the Library Navigator read path (docs/2026-07-10 §Testing):
 * browse (each filter alone + composed + ordering + paging), nav (per-source/collection/
 * kind/tag counts), and search-with-filter narrowing — all against real SQLite + migrations.
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

// Small representative index: three sources, two collection trees, one folder tree,
// distinct kinds/tags, monotonic modifiedAt so ordering assertions are exact.
beforeEach(() => {
  upsert.wipeDerived()
  upsert.upsertCollections('zotero', [
    { externalKey: 'lib', name: 'Library' },
    { externalKey: 'papers', name: 'Papers', parentExternalKey: 'lib' },
  ])
  upsert.upsertCollections('eagle', [{ externalKey: 'fa', name: 'FolderA' }])
  upsert.upsertDocument({ sourceKey: 'zotero', externalKey: 'Z1', uri: 'zotero://Z1', title: 'Alpha Paper', kind: 'pdf', contentSha256: 'h1', modifiedAt: 100, tags: ['ml'], collectionKeys: ['papers'] })
  upsert.upsertDocument({ sourceKey: 'eagle', externalKey: 'E1', uri: 'eagle://E1', title: 'Beta Image', kind: 'image', contentSha256: 'h2', modifiedAt: 200, tags: ['design'], collectionKeys: ['fa'] })
  upsert.upsertDocument({ sourceKey: 'obsidian', externalKey: 'Projects/Foo/gamma.md', uri: 'obsidian://gamma', title: 'Gamma Note', kind: 'note', modifiedAt: 300, tags: ['ml', 'idea'] })
  upsert.upsertDocument({ sourceKey: 'obsidian', externalKey: 'Projects/delta.md', uri: 'obsidian://delta', title: 'Delta Note', kind: 'note', modifiedAt: 400, tags: ['idea'] })
  upsert.upsertDocument({ sourceKey: 'obsidian', externalKey: 'root.md', uri: 'obsidian://root', title: 'Root Note', kind: 'note', modifiedAt: 50 })
})

const collId = (sourceKey: string, externalKey: string): number => {
  const src = handle.db.select().from(s.sources).where(eq(s.sources.key, sourceKey)).get()!
  return handle.db
    .select()
    .from(s.collections)
    .where(and(eq(s.collections.sourceId, src.id), eq(s.collections.externalKey, externalKey)))
    .get()!.id
}
const titles = (page: { hits: { title: string }[] }) => page.hits.map((h) => h.title)

describe('browse', () => {
  it('no filter: all docs, modifiedAt DESC then id DESC, with total', () => {
    const page = queries.browse({})
    expect(page.total).toBe(5)
    expect(titles(page)).toEqual(['Delta Note', 'Gamma Note', 'Beta Image', 'Alpha Paper', 'Root Note'])
  })

  it('BrowseHit shape: tags + per-instance provenance, no snippet', () => {
    const hit = queries.browse({ kind: 'pdf' }).hits[0]!
    expect(hit).toEqual({
      documentId: expect.any(Number),
      title: 'Alpha Paper',
      kind: 'pdf',
      modifiedAt: 100,
      tags: ['ml'],
      instances: [{ sourceKey: 'zotero', uri: 'zotero://Z1', filePath: null }],
    })
    expect(hit).not.toHaveProperty('snippet')
  })

  it('filters by kind', () => {
    expect(titles(queries.browse({ kind: 'note' }))).toEqual(['Delta Note', 'Gamma Note', 'Root Note'])
    expect(queries.browse({ kind: 'note' }).total).toBe(3)
  })

  it('filters by sourceKey', () => {
    expect(titles(queries.browse({ sourceKey: 'obsidian' }))).toEqual(['Delta Note', 'Gamma Note', 'Root Note'])
    expect(titles(queries.browse({ sourceKey: 'zotero' }))).toEqual(['Alpha Paper'])
  })

  it('filters by collectionId (direct membership)', () => {
    expect(titles(queries.browse({ collectionId: collId('zotero', 'papers') }))).toEqual(['Alpha Paper'])
    expect(queries.browse({ collectionId: collId('zotero', 'lib') }).total).toBe(0)
  })

  it('filters by folderPrefix (obsidian externalKey LIKE prefix%)', () => {
    expect(titles(queries.browse({ folderPrefix: 'Projects/' }))).toEqual(['Delta Note', 'Gamma Note'])
    expect(titles(queries.browse({ folderPrefix: 'Projects/Foo/' }))).toEqual(['Gamma Note'])
  })

  it('filters by tag', () => {
    expect(titles(queries.browse({ tag: 'idea' }))).toEqual(['Delta Note', 'Gamma Note'])
    expect(titles(queries.browse({ tag: 'ml' }))).toEqual(['Gamma Note', 'Alpha Paper'])
  })

  it('composes filters with AND', () => {
    expect(titles(queries.browse({ sourceKey: 'obsidian', tag: 'ml' }))).toEqual(['Gamma Note'])
    expect(titles(queries.browse({ kind: 'note', folderPrefix: 'Projects/' }))).toEqual(['Delta Note', 'Gamma Note'])
  })

  it('paginates with offset/limit while total stays the full filtered count', () => {
    expect(titles(queries.browse({ limit: 2, offset: 0 }))).toEqual(['Delta Note', 'Gamma Note'])
    const p2 = queries.browse({ limit: 2, offset: 2 })
    expect(titles(p2)).toEqual(['Beta Image', 'Alpha Paper'])
    expect(p2.total).toBe(5)
    expect(titles(queries.browse({ limit: 2, offset: 4 }))).toEqual(['Root Note'])
  })
})

describe('nav', () => {
  it('kinds carry index-wide counts', () => {
    const kinds = Object.fromEntries(queries.nav().kinds.map((k) => [k.kind, k.count]))
    expect(kinds).toEqual({ pdf: 1, image: 1, note: 3 })
  })

  it('sources carry status, distinct documentCount, and their tree', () => {
    const sources = queries.nav().sources
    const byKey = Object.fromEntries(sources.map((x) => [x.key, x]))
    expect(byKey.zotero?.documentCount).toBe(1)
    expect(byKey.eagle?.documentCount).toBe(1)
    expect(byKey.obsidian?.documentCount).toBe(3)
    expect(byKey.zotero?.status).toBe('ok')
  })

  it('zotero/eagle trees come from collections with direct-membership counts', () => {
    const byKey = Object.fromEntries(queries.nav().sources.map((x) => [x.key, x]))
    const zTree = byKey.zotero!.tree
    expect(zTree.map((n) => n.name)).toEqual(['Library'])
    expect(zTree[0]?.count).toBe(0) // nothing lives directly in Library
    const papers = zTree[0]?.children[0]
    expect(papers?.name).toBe('Papers')
    expect(papers?.count).toBe(1) // Alpha Paper
    expect(byKey.eagle!.tree[0]).toMatchObject({ name: 'FolderA', count: 1 })
  })

  it('obsidian tree is derived from instance relpaths', () => {
    const obs = queries.nav().sources.find((x) => x.key === 'obsidian')!
    expect(obs.tree.map((n) => n.name)).toEqual(['Projects'])
    const projects = obs.tree[0]!
    expect(projects.id).toBe('Projects/')
    expect(projects.count).toBe(1) // delta.md lives directly in Projects/
    expect(projects.children[0]).toMatchObject({ name: 'Foo', id: 'Projects/Foo/', count: 1 })
  })

  it('tags are all rows, counts desc (name asc on ties)', () => {
    expect(queries.nav().tags).toEqual([
      { name: 'idea', count: 2 },
      { name: 'ml', count: 2 },
      { name: 'design', count: 1 },
    ])
  })
})

describe('search with filters', () => {
  it('unfiltered search is unchanged', () => {
    expect(queries.search({ q: 'Note' }).map((h) => h.title).sort()).toEqual(['Delta Note', 'Gamma Note', 'Root Note'])
  })

  it('narrows FTS hits by the browse filters', () => {
    expect(queries.search({ q: 'idea' }).map((h) => h.title).sort()).toEqual(['Delta Note', 'Gamma Note'])
    expect(queries.search({ q: 'idea', folderPrefix: 'Projects/Foo/' }).map((h) => h.title)).toEqual(['Gamma Note'])
    expect(queries.search({ q: 'idea', kind: 'pdf' })).toHaveLength(0)
    expect(queries.search({ q: 'idea', sourceKey: 'obsidian' })).toHaveLength(2)
  })
})
