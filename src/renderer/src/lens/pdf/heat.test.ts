import { describe, it, expect } from 'vitest'
import { countToTier, countsToTiers, rewriteOpenPdfPage } from './heat'

describe('countToTier', () => {
  it('maps 0 → none', () => {
    expect(countToTier(0)).toBe('none')
  })

  it('maps 1 → t1', () => {
    expect(countToTier(1)).toBe('t1')
  })

  it('maps 2 and 3 → t2', () => {
    expect(countToTier(2)).toBe('t2')
    expect(countToTier(3)).toBe('t2')
  })

  it('maps 4 and above → t3', () => {
    expect(countToTier(4)).toBe('t3')
    expect(countToTier(17)).toBe('t3')
  })

  it('treats negative/garbage counts as none (defensive)', () => {
    expect(countToTier(-2)).toBe('none')
  })
})

describe('countsToTiers', () => {
  it('indexes page counts to tiers by pageIndex', () => {
    const tiers = countsToTiers([
      { pageIndex: 0, count: 1 },
      { pageIndex: 4, count: 3 },
      { pageIndex: 9, count: 12 },
    ])
    expect(tiers.get(0)).toBe('t1')
    expect(tiers.get(4)).toBe('t2')
    expect(tiers.get(9)).toBe('t3')
    // Unlisted pages are simply absent (rendered as 'none').
    expect(tiers.has(1)).toBe(false)
  })

  it('is empty for no annotations', () => {
    expect(countsToTiers([]).size).toBe(0)
  })
})

describe('rewriteOpenPdfPage', () => {
  it('replaces an existing page parameter', () => {
    expect(
      rewriteOpenPdfPage('zotero://open-pdf/library/items/VSVGJBTT?page=148', 3),
    ).toBe('zotero://open-pdf/library/items/VSVGJBTT?page=3')
  })

  it('appends a page parameter when none is present', () => {
    expect(rewriteOpenPdfPage('zotero://open-pdf/library/items/VSVGJBTT', 12)).toBe(
      'zotero://open-pdf/library/items/VSVGJBTT?page=12',
    )
  })

  it('preserves other query parameters while rewriting page', () => {
    expect(
      rewriteOpenPdfPage('zotero://open-pdf/library/items/ABC?sel=xyz&page=1', 9),
    ).toBe('zotero://open-pdf/library/items/ABC?sel=xyz&page=9')
  })

  it('appends page alongside an existing non-page query', () => {
    expect(rewriteOpenPdfPage('zotero://open-pdf/library/items/ABC?sel=xyz', 5)).toBe(
      'zotero://open-pdf/library/items/ABC?sel=xyz&page=5',
    )
  })
})
