import { describe, it, expect } from 'vitest'
import { depthValue, normalizeHeat, rewriteOpenPdfPage } from './heat'

/** Convenience: a page-aggregate row with substance defaults of zero. */
const page = (over: Partial<Parameters<typeof depthValue>[0]> = {}) => ({
  count: 0,
  commented: 0,
  textChars: 0,
  commentChars: 0,
  ...over,
})

describe('depthValue (levels-of-processing weighting — orderings, not constants)', () => {
  it('is zero for a page with no annotations', () => {
    expect(depthValue(page())).toBe(0)
  })

  it('a bare annotation with no text still registers (ink/image types stay visible)', () => {
    expect(depthValue(page({ count: 1 }))).toBeGreaterThan(0)
  })

  it('more highlighted text outweighs less, at equal counts', () => {
    const long = depthValue(page({ count: 2, textChars: 800 }))
    const short = depthValue(page({ count: 2, textChars: 80 }))
    expect(long).toBeGreaterThan(short)
  })

  it('a commented page outweighs an equally-highlighted page without comments', () => {
    const commented = depthValue(page({ count: 2, textChars: 200, commented: 1, commentChars: 40 }))
    const bare = depthValue(page({ count: 2, textChars: 200 }))
    expect(commented).toBeGreaterThan(bare)
  })

  it('comment characters outweigh the same number of highlight characters', () => {
    const viaComment = depthValue(page({ count: 1, commented: 1, commentChars: 100 }))
    const viaHighlight = depthValue(page({ count: 1, textChars: 100 }))
    expect(viaComment).toBeGreaterThan(viaHighlight)
  })

  it('a short comment outweighs even a very long bare highlight (generation > recognition)', () => {
    const shortComment = depthValue(page({ count: 1, commented: 1, commentChars: 20 }))
    const hugeHighlight = depthValue(page({ count: 1, textChars: 500 }))
    expect(shortComment).toBeGreaterThan(hugeHighlight)
  })
})

describe('normalizeHeat (relative, continuous intensity per page)', () => {
  it('is empty for no pages', () => {
    expect(normalizeHeat([]).size).toBe(0)
  })

  it('omits zero-value pages (rendered as no heat)', () => {
    const m = normalizeHeat([
      { pageIndex: 0, value: 0 },
      { pageIndex: 1, value: 5 },
    ])
    expect(m.has(0)).toBe(false)
    expect(m.has(1)).toBe(true)
  })

  it('a single annotated page maxes out (relative to THIS document)', () => {
    expect(normalizeHeat([{ pageIndex: 3, value: 2 }]).get(3)).toBe(1)
  })

  it('intensity is monotone in value and spans a continuous range', () => {
    const m = normalizeHeat([
      { pageIndex: 0, value: 1 },
      { pageIndex: 1, value: 4 },
      { pageIndex: 2, value: 16 },
    ])
    const [a, b, c] = [m.get(0)!, m.get(1)!, m.get(2)!]
    expect(a).toBeLessThan(b)
    expect(b).toBeLessThan(c)
    expect(c).toBe(1)
    // Continuous, not stepped: the sqrt curve puts value/reference = 1/4 at exactly 0.5.
    expect(b).toBeCloseTo(0.5, 5)
  })

  it('every intensity lies in (0, 1]', () => {
    const m = normalizeHeat([
      { pageIndex: 0, value: 1 },
      { pageIndex: 1, value: 1000 },
    ])
    for (const v of m.values()) {
      expect(v).toBeGreaterThan(0)
      expect(v).toBeLessThanOrEqual(1)
    }
  })

  it('one outlier page does not flatten the rest (95th-percentile reference, clamped)', () => {
    // 19 pages with values 1..19 plus one 1000-value outlier: nearest-rank p95 of the 20
    // nonzero values is the 19th smallest = 19, so the outlier clamps to 1 and mid pages
    // keep usable contrast instead of collapsing toward 0.
    const values = Array.from({ length: 19 }, (_, i) => ({ pageIndex: i, value: i + 1 }))
    values.push({ pageIndex: 19, value: 1000 })
    const m = normalizeHeat(values)
    expect(m.get(19)).toBe(1) // outlier clamped
    expect(m.get(18)).toBe(1) // the p95 page itself
    expect(m.get(9)!).toBeGreaterThan(0.7) // value 10 vs max-normalization's sqrt(10/1000) ≈ 0.1
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
