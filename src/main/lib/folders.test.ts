import { describe, it, expect } from 'vitest'
import { refsEqual, dedupeRefs, wouldCycle, type FolderMemberRef } from './folders'

/** Tier A unit: the pure rules of the folder primitive (spec §3) — ref
 *  equality across the two shapes, dedupe, and the nesting cycle guard. */
describe('refsEqual', () => {
  const h = (s: string): FolderMemberRef => ({ sha256: s })
  const p = (l: string, k: string): FolderMemberRef => ({ library: l, key: k })

  it('hash refs equal by sha256; path refs by (library, key); shapes never cross-equal', () => {
    expect(refsEqual(h('a'), h('a'))).toBe(true)
    expect(refsEqual(h('a'), h('b'))).toBe(false)
    expect(refsEqual(p('v', 'n.md'), p('v', 'n.md'))).toBe(true)
    expect(refsEqual(p('v', 'n.md'), p('v', 'other.md'))).toBe(false)
    expect(refsEqual(p('v', 'n.md'), p('w', 'n.md'))).toBe(false)
    expect(refsEqual(h('a'), p('v', 'a'))).toBe(false)
  })

  it('dedupeRefs keeps first occurrence, preserves order', () => {
    const refs = [h('a'), p('v', 'n.md'), h('a'), p('v', 'n.md'), h('b')]
    expect(dedupeRefs(refs)).toEqual([h('a'), p('v', 'n.md'), h('b')])
  })
})

describe('wouldCycle', () => {
  // tree: root → mid → leaf   (map: slug → parent slug)
  const tree = new Map<string, string | null>([
    ['root', null],
    ['mid', 'root'],
    ['leaf', 'mid'],
    ['other', null],
  ])

  it('self-parent is a cycle', () => {
    expect(wouldCycle(tree, 'root', 'root')).toBe(true)
  })
  it('parenting under own descendant is a cycle (deep)', () => {
    expect(wouldCycle(tree, 'root', 'leaf')).toBe(true)
  })
  it('parenting under an unrelated folder or null is fine', () => {
    expect(wouldCycle(tree, 'mid', 'other')).toBe(false)
    expect(wouldCycle(tree, 'leaf', null)).toBe(false)
  })
})
