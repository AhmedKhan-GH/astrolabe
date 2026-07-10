// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { toStoredFilter, resolveStoredFilter, selectionFromFilterSet } from './viewRefs'
import { emptySelection, toFilterSet, toggleScope, toggleKind, cycleTag, setTagMatch } from './selection'
import type { NavData, FilterSet, StoredFilter } from './types'

// Collection ids are index-internal; externalKey is the stable, cross-rebuild ref.
const nav: NavData = {
  kinds: [],
  sources: [
    {
      key: 'zotero',
      status: 'ok',
      documentCount: 0,
      tree: [
        {
          id: 1,
          name: 'Root',
          count: 0,
          externalKey: 'ZOT-ROOT',
          children: [{ id: 2, name: 'Child', count: 0, externalKey: 'ZOT-CHILD', children: [] }],
        },
      ],
    },
    {
      key: 'eagle',
      status: 'ok',
      documentCount: 0,
      tree: [{ id: 7, name: 'Shots', count: 0, externalKey: 'EAG-SHOTS', children: [] }],
    },
    // obsidian folders use stable path ids and carry no externalKey — they never
    // become collectionRefs (they ride folderPrefixes).
    { key: 'obsidian', status: 'ok', documentCount: 0, tree: [{ id: 'Notes/', name: 'Notes', count: 0, children: [] }] },
  ],
  tags: [],
}

describe('toStoredFilter', () => {
  it('maps collection ids to stable (sourceKey, externalKey) refs', () => {
    const stored = toStoredFilter({ collectionIds: [1, 2, 7] }, nav)
    expect(stored.collectionRefs).toEqual([
      { sourceKey: 'zotero', key: 'ZOT-ROOT' },
      { sourceKey: 'zotero', key: 'ZOT-CHILD' },
      { sourceKey: 'eagle', key: 'EAG-SHOTS' },
    ])
  })

  it('drops ids not present in the nav trees', () => {
    const stored = toStoredFilter({ collectionIds: [1, 999] }, nav)
    expect(stored.collectionRefs).toEqual([{ sourceKey: 'zotero', key: 'ZOT-ROOT' }])
  })

  it('copies the non-collection fields verbatim and omits collectionRefs when none resolve', () => {
    const fs: FilterSet = {
      sourceKeys: ['zotero'],
      folderPrefixes: ['Notes/'],
      kinds: ['pdf'],
      tagsAll: ['ml'],
      tagsNone: ['draft'],
      collectionIds: [999],
    }
    const stored = toStoredFilter(fs, nav)
    expect(stored).toEqual({
      sourceKeys: ['zotero'],
      folderPrefixes: ['Notes/'],
      kinds: ['pdf'],
      tagsAll: ['ml'],
      tagsNone: ['draft'],
    })
    expect('collectionRefs' in stored).toBe(false)
  })
})

describe('resolveStoredFilter', () => {
  it('resolves refs back to the current collection ids', () => {
    const stored: StoredFilter = {
      collectionRefs: [
        { sourceKey: 'zotero', key: 'ZOT-CHILD' },
        { sourceKey: 'eagle', key: 'EAG-SHOTS' },
      ],
    }
    expect(resolveStoredFilter(stored, nav).collectionIds).toEqual([2, 7])
  })

  it('drops refs that no longer resolve (stale key or wrong source)', () => {
    const stored: StoredFilter = {
      collectionRefs: [
        { sourceKey: 'zotero', key: 'ZOT-ROOT' },
        { sourceKey: 'zotero', key: 'GONE' },
        { sourceKey: 'eagle', key: 'ZOT-CHILD' }, // key exists but under a different source
      ],
    }
    expect(resolveStoredFilter(stored, nav).collectionIds).toEqual([1])
  })

  it('omits collectionIds entirely when nothing resolves', () => {
    const fs = resolveStoredFilter({ collectionRefs: [{ sourceKey: 'zotero', key: 'GONE' }] }, nav)
    expect('collectionIds' in fs).toBe(false)
  })

  it('copies the non-collection fields verbatim', () => {
    const stored: StoredFilter = {
      sourceKeys: ['eagle'],
      folderPrefixes: ['Notes/'],
      kinds: ['image'],
      tagsAny: ['a', 'b'],
    }
    expect(resolveStoredFilter(stored, nav)).toEqual({
      sourceKeys: ['eagle'],
      folderPrefixes: ['Notes/'],
      kinds: ['image'],
      tagsAny: ['a', 'b'],
    })
  })

  it('round-trips ids → refs → ids across a (simulated) rebuild', () => {
    const stored = toStoredFilter({ collectionIds: [1, 2, 7] }, nav)
    expect(resolveStoredFilter(stored, nav).collectionIds).toEqual([1, 2, 7])
  })
})

describe('selectionFromFilterSet — inverse of toFilterSet', () => {
  it('copies scope + kinds arrays', () => {
    const sel = selectionFromFilterSet({
      sourceKeys: ['zotero'],
      collectionIds: [5],
      folderPrefixes: ['Notes/'],
      kinds: ['pdf'],
    })
    expect(sel.sourceKeys).toEqual(['zotero'])
    expect(sel.collectionIds).toEqual([5])
    expect(sel.folderPrefixes).toEqual(['Notes/'])
    expect(sel.kinds).toEqual(['pdf'])
    expect(sel.tags).toEqual([])
  })

  it('tagsAll → required tags with tagMatch "all"', () => {
    const sel = selectionFromFilterSet({ tagsAll: ['ml', 'stats'] })
    expect(sel.tags).toEqual([
      { name: 'ml', mode: 'require' },
      { name: 'stats', mode: 'require' },
    ])
    expect(sel.tagMatch).toBe('all')
  })

  it('tagsAny → required tags with tagMatch "any"', () => {
    const sel = selectionFromFilterSet({ tagsAny: ['ml', 'stats'] })
    expect(sel.tags).toEqual([
      { name: 'ml', mode: 'require' },
      { name: 'stats', mode: 'require' },
    ])
    expect(sel.tagMatch).toBe('any')
  })

  it('tagsNone → excluded tags', () => {
    const sel = selectionFromFilterSet({ tagsNone: ['draft'] })
    expect(sel.tags).toEqual([{ name: 'draft', mode: 'exclude' }])
  })

  it('empty FilterSet → emptySelection', () => {
    expect(selectionFromFilterSet({})).toEqual(emptySelection())
  })

  it.each([
    (() => {
      let s = toggleScope(emptySelection(), 'sourceKeys', 'zotero')
      s = toggleScope(s, 'collectionIds', 5)
      s = toggleKind(s, 'pdf')
      s = cycleTag(s, 'ml') // require
      s = cycleTag(s, 'stats') // require
      return s
    })(),
    (() => {
      let s = cycleTag(emptySelection(), 'ml') // require
      s = cycleTag(s, 'stats') // require
      s = setTagMatch(s, 'any')
      s = cycleTag(cycleTag(s, 'draft'), 'draft') // draft → exclude
      return s
    })(),
  ])('round-trips selection → FilterSet → selection', (sel) => {
    expect(selectionFromFilterSet(toFilterSet(sel))).toEqual(sel)
  })
})
