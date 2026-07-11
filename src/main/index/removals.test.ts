import { describe, it, expect } from 'vitest'
import { chunk } from './removals'

/**
 * Unit tier: the chunking primitive that keeps the sweep's `IN (...)` deletes under SQLite's
 * bound-variable limit when a source lists 10⁴ keys. Pure logic — the DB-touching set-diff
 * (reconcileRemovals) is proven at the integration tier (removals.itest.ts), including 10⁴.
 */
describe('chunk', () => {
  it('splits into ceil(n/size) groups preserving order', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
  })

  it('exact boundary: size divides length evenly → no trailing partial group', () => {
    expect(chunk([1, 2, 3, 4], 2)).toEqual([[1, 2], [3, 4]])
  })

  it('size larger than length → one group', () => {
    expect(chunk([1, 2, 3], 10)).toEqual([[1, 2, 3]])
  })

  it('empty input → no groups', () => {
    expect(chunk([], 5)).toEqual([])
  })

  it('handles 10⁴ keys at a 900-var chunk boundary (12 groups: 11×900 + 1×100)', () => {
    const keys = Array.from({ length: 10_000 }, (_, i) => `K${i}`)
    const groups = chunk(keys, 900)
    expect(groups).toHaveLength(12)
    expect(groups.slice(0, 11).every((g) => g.length === 900)).toBe(true)
    expect(groups[11]).toHaveLength(100)
    // Flattening round-trips the input exactly (no dropped/duplicated keys).
    expect(groups.flat()).toEqual(keys)
  })
})
