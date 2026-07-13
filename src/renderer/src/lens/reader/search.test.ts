import { describe, it, expect } from 'vitest'
import { searchPages } from './search'

describe('searchPages', () => {
  it('returns page-level hit counts, in page order, for matching pages only', () => {
    const texts = ['the cat sat', 'no match here', 'cat and cat']
    expect(searchPages(texts, 'cat')).toEqual([
      { pageIndex: 0, count: 1 },
      { pageIndex: 2, count: 2 },
    ])
  })

  it('is case-insensitive', () => {
    expect(searchPages(['The CAT'], 'cat')).toEqual([{ pageIndex: 0, count: 1 }])
    expect(searchPages(['the cat'], 'CAT')).toEqual([{ pageIndex: 0, count: 1 }])
  })

  it('returns [] for an empty query', () => {
    expect(searchPages(['anything'], '')).toEqual([])
  })

  it('skips not-yet-fetched pages (null) without counting them', () => {
    const texts: (string | null)[] = ['cat', null, 'cat cat']
    expect(searchPages(texts, 'cat')).toEqual([
      { pageIndex: 0, count: 1 },
      { pageIndex: 2, count: 2 },
    ])
  })

  it('counts non-overlapping occurrences', () => {
    expect(searchPages(['aaaa'], 'aa')).toEqual([{ pageIndex: 0, count: 2 }])
  })

  it('returns [] when nothing matches', () => {
    expect(searchPages(['alpha', 'beta'], 'gamma')).toEqual([])
  })
})
