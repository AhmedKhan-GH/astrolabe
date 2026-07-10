// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import {
  emptySelection,
  toggleScope,
  toggleKind,
  togglePresence,
  cycleTag,
  setTagMatch,
  removeTag,
  clearAll,
  isEmpty,
  toFilterSet,
} from './selection'

describe('emptySelection', () => {
  it('is a no-constraint selection', () => {
    const s = emptySelection()
    expect(s).toEqual({
      sourceKeys: [],
      collectionIds: [],
      folderPrefixes: [],
      virtualCollections: [],
      kinds: [],
      tags: [],
      tagMatch: 'all',
      presence: [],
    })
    expect(isEmpty(s)).toBe(true)
  })
})

describe('toggleScope', () => {
  it('adds a value to an empty scope dimension', () => {
    expect(toggleScope(emptySelection(), 'sourceKeys', 'zotero').sourceKeys).toEqual(['zotero'])
  })

  it('is a union — a second value joins, not replaces', () => {
    const s = toggleScope(toggleScope(emptySelection(), 'sourceKeys', 'zotero'), 'sourceKeys', 'eagle')
    expect(s.sourceKeys).toEqual(['zotero', 'eagle'])
  })

  it('toggles a present value off (click-again)', () => {
    const s = toggleScope(emptySelection(), 'collectionIds', 5)
    expect(toggleScope(s, 'collectionIds', 5).collectionIds).toEqual([])
  })

  it('does NOT clear other dimensions (no cross-dimension reset)', () => {
    let s = toggleScope(emptySelection(), 'sourceKeys', 'zotero')
    s = toggleScope(s, 'collectionIds', 5)
    s = toggleScope(s, 'folderPrefixes', 'Projects/')
    s = toggleScope(s, 'virtualCollections', 'to-read')
    expect(s.sourceKeys).toEqual(['zotero'])
    expect(s.collectionIds).toEqual([5])
    expect(s.folderPrefixes).toEqual(['Projects/'])
    expect(s.virtualCollections).toEqual(['to-read'])
  })

  it('unions and toggles-off virtual collection slugs like any other scope dim', () => {
    let s = toggleScope(emptySelection(), 'virtualCollections', 'to-read')
    s = toggleScope(s, 'virtualCollections', 'faves')
    expect(s.virtualCollections).toEqual(['to-read', 'faves'])
    expect(toggleScope(s, 'virtualCollections', 'to-read').virtualCollections).toEqual(['faves'])
  })
})

describe('toggleKind', () => {
  it('adds then removes a kind (multi-select)', () => {
    let s = toggleKind(emptySelection(), 'pdf')
    s = toggleKind(s, 'image')
    expect(s.kinds).toEqual(['pdf', 'image'])
    s = toggleKind(s, 'pdf')
    expect(s.kinds).toEqual(['image'])
  })
})

describe('cycleTag', () => {
  it('cycles neutral → require → exclude → neutral', () => {
    let s = emptySelection()
    s = cycleTag(s, 'ml')
    expect(s.tags).toEqual([{ name: 'ml', mode: 'require' }])
    s = cycleTag(s, 'ml')
    expect(s.tags).toEqual([{ name: 'ml', mode: 'exclude' }])
    s = cycleTag(s, 'ml')
    expect(s.tags).toEqual([])
  })

  it('cycles tags independently', () => {
    let s = cycleTag(emptySelection(), 'ml') // require
    s = cycleTag(s, 'physics') // require
    s = cycleTag(s, 'physics') // exclude
    expect(s.tags).toEqual([
      { name: 'ml', mode: 'require' },
      { name: 'physics', mode: 'exclude' },
    ])
  })
})

describe('togglePresence', () => {
  it('adds then removes a bucket (multi-select, its own AND-dimension)', () => {
    let s = togglePresence(emptySelection(), 'both')
    s = togglePresence(s, 'eagle-only')
    expect(s.presence).toEqual(['both', 'eagle-only'])
    s = togglePresence(s, 'both')
    expect(s.presence).toEqual(['eagle-only'])
  })

  it('never touches the scope dimensions', () => {
    const s = togglePresence(toggleScope(emptySelection(), 'sourceKeys', 'zotero'), 'zotero-only')
    expect(s.sourceKeys).toEqual(['zotero'])
    expect(s.presence).toEqual(['zotero-only'])
  })
})

describe('setTagMatch', () => {
  it('flips the match mode', () => {
    expect(setTagMatch(emptySelection(), 'any').tagMatch).toBe('any')
    expect(setTagMatch(setTagMatch(emptySelection(), 'any'), 'all').tagMatch).toBe('all')
  })
})

describe('removeTag', () => {
  it('drops a tag whatever its mode', () => {
    const s = cycleTag(emptySelection(), 'ml') // require
    expect(removeTag(s, 'ml').tags).toEqual([])
  })
})

describe('clearAll / isEmpty', () => {
  it('clearAll returns an empty selection', () => {
    expect(isEmpty(clearAll())).toBe(true)
  })

  it('isEmpty is false once any facet is active', () => {
    expect(isEmpty(toggleKind(emptySelection(), 'pdf'))).toBe(false)
    expect(isEmpty(cycleTag(emptySelection(), 'ml'))).toBe(false)
    expect(isEmpty(toggleScope(emptySelection(), 'sourceKeys', 'zotero'))).toBe(false)
    expect(isEmpty(toggleScope(emptySelection(), 'virtualCollections', 'to-read'))).toBe(false)
    expect(isEmpty(togglePresence(emptySelection(), 'both'))).toBe(false)
  })

  it('tagMatch alone does not make a selection non-empty', () => {
    expect(isEmpty(setTagMatch(emptySelection(), 'any'))).toBe(true)
  })
})

describe('toFilterSet', () => {
  it('empty selection → empty object (all arrays omitted)', () => {
    expect(toFilterSet(emptySelection())).toEqual({})
  })

  it('maps scope + kinds arrays through', () => {
    let s = toggleScope(emptySelection(), 'sourceKeys', 'zotero')
    s = toggleScope(s, 'collectionIds', 5)
    s = toggleScope(s, 'folderPrefixes', 'Projects/')
    s = toggleScope(s, 'virtualCollections', 'to-read')
    s = toggleKind(s, 'pdf')
    expect(toFilterSet(s)).toEqual({
      sourceKeys: ['zotero'],
      collectionIds: [5],
      folderPrefixes: ['Projects/'],
      virtualCollections: ['to-read'],
      kinds: ['pdf'],
    })
  })

  it('emits virtualCollections slugs, omitting the empty array', () => {
    expect('virtualCollections' in toFilterSet(emptySelection())).toBe(false)
    let s = toggleScope(emptySelection(), 'virtualCollections', 'to-read')
    s = toggleScope(s, 'virtualCollections', 'faves')
    expect(toFilterSet(s)).toEqual({ virtualCollections: ['to-read', 'faves'] })
  })

  it('emits presence values, omitting the empty array', () => {
    expect('presence' in toFilterSet(emptySelection())).toBe(false)
    let s = togglePresence(emptySelection(), 'both')
    s = togglePresence(s, 'zotero-only')
    expect(toFilterSet(s)).toEqual({ presence: ['both', 'zotero-only'] })
  })

  it('required tags → tagsAll when tagMatch is "all"', () => {
    let s = cycleTag(emptySelection(), 'ml')
    s = cycleTag(s, 'stats')
    expect(toFilterSet(s)).toEqual({ tagsAll: ['ml', 'stats'] })
  })

  it('required tags → tagsAny when tagMatch is "any"', () => {
    let s = cycleTag(emptySelection(), 'ml')
    s = cycleTag(s, 'stats')
    s = setTagMatch(s, 'any')
    expect(toFilterSet(s)).toEqual({ tagsAny: ['ml', 'stats'] })
  })

  it('excluded tags → tagsNone, independent of tagMatch', () => {
    let s = cycleTag(cycleTag(emptySelection(), 'ml'), 'ml') // ml → exclude
    s = setTagMatch(s, 'any')
    expect(toFilterSet(s)).toEqual({ tagsNone: ['ml'] })
  })

  it('composes required and excluded tags simultaneously', () => {
    let s = cycleTag(emptySelection(), 'ml') // require
    s = cycleTag(cycleTag(s, 'draft'), 'draft') // draft → exclude
    expect(toFilterSet(s)).toEqual({ tagsAll: ['ml'], tagsNone: ['draft'] })
  })

  it('omits empty arrays entirely', () => {
    const fs = toFilterSet(toggleKind(emptySelection(), 'pdf'))
    expect(Object.keys(fs)).toEqual(['kinds'])
  })
})
