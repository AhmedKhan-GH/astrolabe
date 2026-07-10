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
  it('empty FilterSet: all docs, modifiedAt DESC then id DESC, with total', () => {
    const page = queries.browse({})
    expect(page.total).toBe(5)
    expect(titles(page)).toEqual(['Delta Note', 'Gamma Note', 'Beta Image', 'Alpha Paper', 'Root Note'])
  })

  it('BrowseHit shape: tags + per-instance provenance, no snippet', () => {
    const hit = queries.browse({ kinds: ['pdf'] }).hits[0]!
    expect(hit).toEqual({
      documentId: expect.any(Number),
      title: 'Alpha Paper',
      kind: 'pdf',
      modifiedAt: 100,
      tags: ['ml'],
      instances: [{ sourceKey: 'zotero', uri: 'zotero://Z1', filePath: null }],
      virtualCollections: [],
    })
    expect(hit).not.toHaveProperty('snippet')
  })

  it('kinds: d.kind IN (…) — single and multi', () => {
    expect(titles(queries.browse({ kinds: ['note'] }))).toEqual(['Delta Note', 'Gamma Note', 'Root Note'])
    expect(queries.browse({ kinds: ['note'] }).total).toBe(3)
    expect(titles(queries.browse({ kinds: ['pdf', 'image'] }))).toEqual(['Beta Image', 'Alpha Paper'])
  })

  describe('scope (sources ∪ collections ∪ folders)', () => {
    it('sourceKeys alone: union across the selected sources', () => {
      expect(titles(queries.browse({ sourceKeys: ['obsidian'] }))).toEqual(['Delta Note', 'Gamma Note', 'Root Note'])
      expect(titles(queries.browse({ sourceKeys: ['zotero', 'eagle'] }))).toEqual(['Beta Image', 'Alpha Paper'])
    })

    it('collectionIds alone: direct membership, union across collections', () => {
      expect(titles(queries.browse({ collectionIds: [collId('zotero', 'papers')] }))).toEqual(['Alpha Paper'])
      expect(queries.browse({ collectionIds: [collId('zotero', 'lib')] }).total).toBe(0) // nothing lives directly in Library
      expect(
        titles(queries.browse({ collectionIds: [collId('zotero', 'papers'), collId('eagle', 'fa')] })),
      ).toEqual(['Beta Image', 'Alpha Paper'])
    })

    it('folderPrefixes alone: obsidian externalKey LIKE prefix%, union', () => {
      expect(titles(queries.browse({ folderPrefixes: ['Projects/'] }))).toEqual(['Delta Note', 'Gamma Note'])
      expect(titles(queries.browse({ folderPrefixes: ['Projects/Foo/'] }))).toEqual(['Gamma Note'])
      expect(titles(queries.browse({ folderPrefixes: ['Projects/Foo/', 'root.md'] }))).toEqual([
        'Gamma Note',
        'Root Note',
      ])
    })

    it('unions the three sub-dimensions with OR (not AND)', () => {
      // zotero source (Alpha) ∪ eagle FolderA collection (Beta) ∪ obsidian Projects/Foo/ (Gamma)
      expect(
        titles(
          queries.browse({
            sourceKeys: ['zotero'],
            collectionIds: [collId('eagle', 'fa')],
            folderPrefixes: ['Projects/Foo/'],
          }),
        ),
      ).toEqual(['Gamma Note', 'Beta Image', 'Alpha Paper'])
    })
  })

  describe('tags: ALL / ANY / NONE produce distinct results', () => {
    it('tagsAll: document carries every named tag', () => {
      expect(titles(queries.browse({ tagsAll: ['ml', 'idea'] }))).toEqual(['Gamma Note'])
      expect(titles(queries.browse({ tagsAll: ['idea'] }))).toEqual(['Delta Note', 'Gamma Note'])
    })

    it('tagsAny: at least one named tag', () => {
      expect(titles(queries.browse({ tagsAny: ['ml', 'idea'] }))).toEqual(['Delta Note', 'Gamma Note', 'Alpha Paper'])
    })

    it('tagsNone: none of the named tags', () => {
      expect(titles(queries.browse({ tagsNone: ['ml', 'idea'] }))).toEqual(['Beta Image', 'Root Note'])
    })

    it('the three modes compose (AND) on one fixture', () => {
      // require idea (Gamma, Delta) ∧ any of ml (Gamma) ∧ none of design (Gamma) → Gamma
      expect(
        titles(queries.browse({ tagsAll: ['idea'], tagsAny: ['ml'], tagsNone: ['design'] })),
      ).toEqual(['Gamma Note'])
    })
  })

  it('composes scope + kinds + tags with AND', () => {
    expect(titles(queries.browse({ sourceKeys: ['obsidian'], tagsAll: ['ml'] }))).toEqual(['Gamma Note'])
    expect(titles(queries.browse({ kinds: ['note'], folderPrefixes: ['Projects/'] }))).toEqual([
      'Delta Note',
      'Gamma Note',
    ])
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

  it('narrows FTS hits by the FilterSet (MATCH ∧ filters)', () => {
    expect(queries.search({ q: 'idea' }).map((h) => h.title).sort()).toEqual(['Delta Note', 'Gamma Note'])
    expect(queries.search({ q: 'idea', folderPrefixes: ['Projects/Foo/'] }).map((h) => h.title)).toEqual(['Gamma Note'])
    expect(queries.search({ q: 'idea', kinds: ['pdf'] })).toHaveLength(0)
    expect(queries.search({ q: 'idea', sourceKeys: ['obsidian'] })).toHaveLength(2)
    expect(queries.search({ q: 'Note', tagsNone: ['idea'] }).map((h) => h.title)).toEqual(['Root Note'])
  })
})

describe('virtual collections (mirror scope + nav + hydration)', () => {
  const docIdByTitle = (title: string): number =>
    handle.db.select().from(s.documents).where(eq(s.documents.title, title)).get()!.id
  const seedVC = (slug: string, name: string, docIds: number[]): void => {
    const vcId = handle.db.insert(s.virtualCollections).values({ slug, name }).returning().get().id
    for (const documentId of docIds)
      handle.db.insert(s.virtualCollectionMembers).values({ vcId, documentId }).run()
  }
  // The vc mirror is not touched by wipeDerived (it is rebuilt from files by syncVirtualCollections),
  // so clear it explicitly between cases after the outer beforeEach has re-seeded the documents.
  beforeEach(() => {
    handle.db.delete(s.virtualCollectionMembers).run()
    handle.db.delete(s.virtualCollections).run()
  })

  it('browse filters by slug as a fourth scope sub-predicate', () => {
    seedVC('reading', 'Reading', [docIdByTitle('Alpha Paper'), docIdByTitle('Gamma Note')])
    expect(titles(queries.browse({ virtualCollections: ['reading'] }))).toEqual(['Gamma Note', 'Alpha Paper'])
    expect(queries.browse({ virtualCollections: ['reading'] }).total).toBe(2)
    expect(queries.browse({ virtualCollections: ['nonexistent'] }).total).toBe(0)
  })

  it('ORs with the other scope dims (source/collection/folder)', () => {
    seedVC('reading', 'Reading', [docIdByTitle('Alpha Paper'), docIdByTitle('Gamma Note')])
    // reading (Alpha, Gamma) ∪ eagle source (Beta) — a union, not an intersection.
    expect(titles(queries.browse({ virtualCollections: ['reading'], sourceKeys: ['eagle'] }))).toEqual([
      'Gamma Note',
      'Beta Image',
      'Alpha Paper',
    ])
  })

  it('search narrows FTS hits by slug too', () => {
    seedVC('reading', 'Reading', [docIdByTitle('Gamma Note')])
    expect(queries.search({ q: 'Note', virtualCollections: ['reading'] }).map((h) => h.title)).toEqual(['Gamma Note'])
  })

  it('nav returns name-sorted summaries with distinct member counts (empty at 0)', () => {
    seedVC('reading', 'Reading', [docIdByTitle('Alpha Paper'), docIdByTitle('Gamma Note')])
    seedVC('empty', 'Empty', [])
    expect(queries.nav().virtualCollections).toEqual([
      { slug: 'empty', name: 'Empty', count: 0 },
      { slug: 'reading', name: 'Reading', count: 2 },
    ])
  })

  it('hydrate carries the slugs a document belongs to (sorted)', () => {
    const gamma = docIdByTitle('Gamma Note')
    seedVC('reading', 'Reading', [gamma])
    seedVC('ideas', 'Ideas', [gamma])
    const hit = queries.browse({ kinds: ['note'] }).hits.find((h) => h.title === 'Gamma Note')!
    expect(hit.virtualCollections).toEqual(['ideas', 'reading'])
    const other = queries.browse({ kinds: ['note'] }).hits.find((h) => h.title === 'Delta Note')!
    expect(other.virtualCollections).toEqual([])
  })
})

describe('presence (zotero/eagle instance existence — its own AND dimension)', () => {
  // A doc "in both" is one document with a zotero AND an eagle instance — created by the
  // hash join (same contentSha256 across the two sources). Alpha (zotero, h1) is zotero-only,
  // Beta (eagle, h2) is eagle-only, the obsidian notes match no presence value.
  beforeEach(() => {
    upsert.upsertDocument({ sourceKey: 'zotero', externalKey: 'ZB', uri: 'zotero://ZB', title: 'Both Doc', kind: 'pdf', contentSha256: 'hboth', modifiedAt: 500 })
    upsert.upsertDocument({ sourceKey: 'eagle', externalKey: 'EB', uri: 'eagle://EB', title: 'Both Doc', kind: 'pdf', contentSha256: 'hboth', modifiedAt: 500 })
  })

  it('each value alone selects the right documents', () => {
    expect(titles(queries.browse({ presence: ['both'] }))).toEqual(['Both Doc'])
    expect(titles(queries.browse({ presence: ['zotero-only'] }))).toEqual(['Alpha Paper'])
    expect(titles(queries.browse({ presence: ['eagle-only'] }))).toEqual(['Beta Image'])
  })

  it('an array of values is an internal OR', () => {
    expect(titles(queries.browse({ presence: ['zotero-only', 'eagle-only'] }))).toEqual([
      'Beta Image',
      'Alpha Paper',
    ])
    expect(queries.browse({ presence: ['both', 'zotero-only', 'eagle-only'] }).total).toBe(3)
  })

  it('obsidian-only notes match no presence value', () => {
    const all = queries.browse({ presence: ['both', 'zotero-only', 'eagle-only'] })
    expect(all.hits.some((h) => h.title === 'Gamma Note')).toBe(false)
  })

  it('ANDs with scope (it is NOT in the scope OR-set)', () => {
    // eagle-only = {Beta}. If presence were OR-ed into scope, adding sourceKeys:['zotero']
    // would UNION in the zotero docs; because it ANDs, Beta (not in zotero) drops out → empty.
    expect(queries.browse({ presence: ['eagle-only'], sourceKeys: ['zotero'] }).total).toBe(0)
    // both = {Both Doc}, which is in zotero → survives the AND with the zotero scope.
    expect(titles(queries.browse({ presence: ['both'], sourceKeys: ['zotero'] }))).toEqual(['Both Doc'])
  })

  it('ANDs with a tag filter', () => {
    expect(titles(queries.browse({ presence: ['zotero-only'], tagsAll: ['ml'] }))).toEqual(['Alpha Paper'])
    expect(queries.browse({ presence: ['zotero-only'], tagsAll: ['design'] }).total).toBe(0)
  })

  it('narrows FTS search too', () => {
    expect(queries.search({ q: 'Doc', presence: ['both'] }).map((h) => h.title)).toEqual(['Both Doc'])
    expect(queries.search({ q: 'Doc', presence: ['zotero-only'] })).toHaveLength(0)
  })

  it('nav carries the three presence counts', () => {
    expect(queries.nav().presence).toEqual([
      { value: 'both', count: 1 },
      { value: 'zotero-only', count: 1 },
      { value: 'eagle-only', count: 1 },
    ])
  })

  it('Zod rejects an over-cap presence array', () => {
    expect(() => queries.browse({ presence: ['both', 'zotero-only', 'eagle-only', 'both'] as never })).toThrow()
  })
})

describe('FilterSet schema', () => {
  it('empty FilterSet is unfiltered (browse-all)', () => {
    expect(queries.browse({}).total).toBe(5)
  })

  it('Zod rejects over-cap arrays', () => {
    expect(() => queries.browse({ sourceKeys: ['zotero', 'eagle', 'obsidian', 'zotero'] })).toThrow()
    expect(() => queries.browse({ tagsAll: Array.from({ length: 51 }, (_, i) => `t${i}`) })).toThrow()
    expect(() => queries.search({ q: 'x', kinds: ['pdf', 'image', 'note', 'other', 'pdf'] })).toThrow()
  })
})
