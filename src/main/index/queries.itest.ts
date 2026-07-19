import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, type DbHandle } from '../db'
import { createUpsertApi, type UpsertApi } from './upsert'
import { reconcileRemovals } from './removals'
import { createIndexQueries, type IndexQueries } from './queries'
import { createFoldersStore, type FoldersStore } from '../lib/folders'
import { syncFolders } from './folder-mirror'
import { resolveLinks } from './links'

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

describe('folder scope + Uncategorized (folders spec §6)', () => {
  // Local helpers: a folder store + mirror inside this suite's tmp dir.
  const makeFolders = (): FoldersStore => {
    const fdir = join(dir, `folders-${Math.random().toString(36).slice(2)}`)
    return createFoldersStore(fdir)
  }

  it('folderSlugs scopes browse; includeSubfolders pulls descendants', () => {
    const z = lib('zotero', '1')
    put(z.id, { externalKey: 'A', contentSha256: 'h-a', title: 'In Root' })
    put(z.id, { externalKey: 'B', contentSha256: 'h-b', title: 'In Child' })
    put(z.id, { externalKey: 'C', contentSha256: 'h-c', title: 'Unfiled' })
    const store = makeFolders()
    const root = store.create({ name: 'Root' })
    const child = store.create({ name: 'Child', parent: root.slug })
    store.addMembers(root.slug, [{ sha256: 'h-a' }])
    store.addMembers(child.slug, [{ sha256: 'h-b' }])
    syncFolders(handle.db, store)

    expect(queries.browse({ folderSlugs: ['root'] }).total).toBe(1)
    expect(queries.browse({ folderSlugs: ['root'], includeSubfolders: true }).total).toBe(2)
    expect(queries.search({ q: 'child', folderSlugs: ['root'] })).toHaveLength(0)
    expect(queries.search({ q: 'child', folderSlugs: ['root'], includeSubfolders: true })).toHaveLength(1)
    // A filter that resolves to no folder (deleted/unknown slug) matches
    // NOTHING — it is not "no filter". Guards the empty-id-set rule.
    expect(queries.browse({ folderSlugs: ['ghost-folder'] }).total).toBe(0)
  })

  it('uncategorized = member of no folder; counts feed the rail', () => {
    const z = lib('zotero', '1')
    put(z.id, { externalKey: 'A', contentSha256: 'h-a', title: 'Filed' })
    put(z.id, { externalKey: 'B', contentSha256: 'h-b', title: 'Inbox item' })
    const store = makeFolders()
    const f = store.create({ name: 'F' })
    store.addMembers(f.slug, [{ sha256: 'h-a' }])
    syncFolders(handle.db, store)

    const inbox = queries.browse({ uncategorized: true })
    expect(inbox.total).toBe(1)
    expect(inbox.hits[0]?.title).toBe('Inbox item')
    expect(queries.uncategorizedCount()).toBe(1)
  })

  it('folderTree carries own + subtree counts (multi-membership not double-counted in subtree)', () => {
    const z = lib('zotero', '1')
    put(z.id, { externalKey: 'A', contentSha256: 'h-a' })
    put(z.id, { externalKey: 'B', contentSha256: 'h-b' })
    const store = makeFolders()
    const root = store.create({ name: 'Root' })
    const child = store.create({ name: 'Child', parent: root.slug })
    store.addMembers(root.slug, [{ sha256: 'h-a' }])
    store.addMembers(child.slug, [{ sha256: 'h-a' }, { sha256: 'h-b' }]) // h-a in both
    syncFolders(handle.db, store)

    const tree = queries.folderTree()
    expect(tree).toHaveLength(1)
    expect(tree[0]?.ownCount).toBe(1)
    expect(tree[0]?.subtreeCount).toBe(2) // distinct docs across root ∪ child
    expect(tree[0]?.children[0]?.ownCount).toBe(2)
  })

  it('ghost members drop out of folderTree counts but keep membership (spec §6 anchored rule)', () => {
    const z = lib('zotero', '1')
    put(z.id, { externalKey: 'A', contentSha256: 'h-a', title: 'Keeper' })
    put(z.id, { externalKey: 'B', contentSha256: 'h-b', title: 'Goner' })
    const store = makeFolders()
    const f = store.create({ name: 'F' })
    store.addMembers(f.slug, [{ sha256: 'h-a' }, { sha256: 'h-b' }])
    reconcileRemovals(handle.db, z.id, ['A']) // B's sole copy gone → ghost
    syncFolders(handle.db, store)

    // Counts see only anchored members — consistent with what clicking shows.
    const tree = queries.folderTree()
    expect(tree[0]?.ownCount).toBe(1)
    expect(tree[0]?.subtreeCount).toBe(1)
    expect(queries.browse({ folderSlugs: [f.slug] }).total).toBe(1)
    // Membership retained: the one toggle reveals the ghost inside the folder.
    expect(queries.browse({ folderSlugs: [f.slug], includeGhosts: true }).total).toBe(2)
  })
})

describe('documentDetail — the document hub payload (frame spec §4)', () => {
  const makeFolders = (): FoldersStore => {
    const fdir = join(dir, `folders-${Math.random().toString(36).slice(2)}`)
    return createFoldersStore(fdir)
  }

  it('composes instances, tags, folder chips, annotation preview (cap 5) and backlinks', () => {
    const vault = lib('obsidian', 'v1')
    // The subject: an obsidian note carrying 7 annotations (preview must cap 5).
    const annotations = Array.from({ length: 7 }, (_, i) => ({
      externalKey: `A${i}`,
      type: 'highlight',
      text: `note ${i}`,
      pageLabel: `${i}`,
      modifiedAt: 1000 + i,
    }))
    const { documentId } = put(vault.id, {
      externalKey: 'subject.md',
      uri: 'obsidian://open?file=subject.md',
      title: 'Subject',
      kind: 'note',
      contentSha256: 'h-subj',
      tags: ['ml', 'textbook'],
      annotations,
    })
    // File it into a folder → a membership chip.
    const store = makeFolders()
    const f = store.create({ name: 'Reading' })
    store.addMembers(f.slug, [{ sha256: 'h-subj' }])
    syncFolders(handle.db, store)
    // A note linking to the subject → a backlink (resolved post-sync).
    put(vault.id, {
      externalKey: 'linker.md',
      uri: 'obsidian://open?file=linker.md',
      title: 'Linking Note',
      kind: 'note',
      contentSha256: null,
      links: ['subject'],
    })
    resolveLinks(handle.db)

    const detail = queries.documentDetail({ documentId })
    expect(detail).not.toBeNull()
    expect(detail?.documentId).toBe(documentId)
    expect(detail?.title).toBe('Subject')
    expect(detail?.kind).toBe('note')
    expect(detail?.tags).toEqual(expect.arrayContaining(['ml', 'textbook']))
    expect(detail?.instances).toHaveLength(1)
    expect(detail?.instances[0]?.connectorKey).toBe('obsidian')
    expect(detail?.folders).toEqual([{ slug: f.slug, name: 'Reading' }])
    expect(detail?.annotations.total).toBe(7)
    expect(detail?.annotations.preview).toHaveLength(5)
    expect(detail?.annotations.preview[0]?.text).toBe('note 0') // first 5 by id
    expect(detail?.backlinks).toHaveLength(1)
    expect(detail?.backlinks[0]?.title).toBe('Linking Note')
  })

  it('returns null for an unknown document id', () => {
    expect(queries.documentDetail({ documentId: 999_999 })).toBeNull()
  })

  it('a ghost document still returns detail, with zero instances', () => {
    const z = lib('zotero', '1')
    const { documentId } = put(z.id, { externalKey: 'G', contentSha256: 'h-g', title: 'Ghost' })
    reconcileRemovals(handle.db, z.id, []) // sole copy gone → ghost
    const detail = queries.documentDetail({ documentId })
    expect(detail).not.toBeNull()
    expect(detail?.title).toBe('Ghost')
    expect(detail?.instances).toHaveLength(0)
  })
})

describe('tagsList — the rail tag list (frame spec §4)', () => {
  it('counts distinct documents per tag, desc by count then name', () => {
    const z = lib('zotero', '1')
    put(z.id, { externalKey: 'A', contentSha256: 'h-a', tags: ['ml', 'stats'] })
    put(z.id, { externalKey: 'B', contentSha256: 'h-b', tags: ['ml'] })
    put(z.id, { externalKey: 'C', contentSha256: 'h-c', tags: ['ml', 'stats'] })
    expect(queries.tagsList()).toEqual([
      { name: 'ml', count: 3 },
      { name: 'stats', count: 2 },
    ])
  })
})
