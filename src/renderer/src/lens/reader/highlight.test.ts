import { describe, it, expect } from 'vitest'
import { mapMatchesToSpans, type SpanSlice } from './highlight'

// mapMatchesToSpans concatenates the pdf.js visual runs (spans) DIRECTLY — no injected
// separators — and finds case-insensitive, non-overlapping occurrences of the query in that
// concatenation, then maps each match back to the per-span character slices it covers. The
// caller derives its `spanTexts` from the same span set in the same order, so the offsets line
// up. Boundary rule (documented by the tests below): a slice is emitted for a span only when the
// match has a NON-EMPTY intersection with it — a match that starts or ends exactly on a span
// boundary yields no zero-width slice for the adjacent span, and empty spans contribute nothing.

const S = (spanIndex: number, start: number, end: number): SpanSlice => ({ spanIndex, start, end })

describe('mapMatchesToSpans', () => {
  it('maps a match contained in a single span', () => {
    expect(mapMatchesToSpans(['hello world'], 'world')).toEqual([[S(0, 6, 11)]])
  })

  it('maps a match that crosses two spans (direct concatenation, no separator)', () => {
    // 'foo' + 'bar' = 'foobar'; 'oba' spans the seam at index 2..5.
    expect(mapMatchesToSpans(['foo', 'bar'], 'oba')).toEqual([[S(0, 2, 3), S(1, 0, 2)]])
  })

  it('maps a match that crosses three spans', () => {
    // 'ab'+'cd'+'ef' = 'abcdef'; 'bcde' covers span0[1..2], span1[0..2], span2[0..1].
    expect(mapMatchesToSpans(['ab', 'cd', 'ef'], 'bcde')).toEqual([
      [S(0, 1, 2), S(1, 0, 2), S(2, 0, 1)],
    ])
  })

  it('returns one SpanSlice[] per match, in order', () => {
    // 'a'+'x'+'a' = 'axa'; two matches of 'a' (span 0 and span 2), the 'x' span uninvolved.
    expect(mapMatchesToSpans(['a', 'x', 'a'], 'a')).toEqual([[S(0, 0, 1)], [S(2, 0, 1)]])
  })

  it('counts non-overlapping occurrences within a single span', () => {
    expect(mapMatchesToSpans(['aaaa'], 'aa')).toEqual([[S(0, 0, 2)], [S(0, 2, 4)]])
  })

  it('is case-insensitive in both directions', () => {
    expect(mapMatchesToSpans(['Hello'], 'hello')).toEqual([[S(0, 0, 5)]])
    expect(mapMatchesToSpans(['hello'], 'HELLO')).toEqual([[S(0, 0, 5)]])
  })

  it('handles a match landing exactly on a span boundary without zero-width slices', () => {
    // 'cd' straddles the seam of 'abc'|'def'.
    expect(mapMatchesToSpans(['abc', 'def'], 'cd')).toEqual([[S(0, 2, 3), S(1, 0, 1)]])
    // A match filling span 0 exactly emits ONE slice — no zero-width slice for span 1.
    expect(mapMatchesToSpans(['abc', 'def'], 'abc')).toEqual([[S(0, 0, 3)]])
  })

  it('skips empty spans when mapping (they contribute no text and no slice)', () => {
    // 'ab'+''+'cd' = 'abcd'; 'bc' spans the (empty) seam — the empty span yields no slice.
    expect(mapMatchesToSpans(['ab', '', 'cd'], 'bc')).toEqual([[S(0, 1, 2), S(2, 0, 1)]])
  })

  it('returns [] for an empty query', () => {
    expect(mapMatchesToSpans(['abc'], '')).toEqual([])
  })

  it('returns [] when nothing matches', () => {
    expect(mapMatchesToSpans(['abc', 'def'], 'zzz')).toEqual([])
  })

  it('returns [] for an empty spans array', () => {
    expect(mapMatchesToSpans([], 'a')).toEqual([])
  })
})
