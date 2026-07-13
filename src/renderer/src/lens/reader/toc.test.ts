import { describe, it, expect } from 'vitest'
import {
  flattenOutline,
  tocPageRanges,
  findTocPathsForPages,
  currentTocPath,
  type OutlineEntry,
} from './toc'

// A deeply-nested outline (all pages present) exercising every section-boundary shape:
//   A            page 0   (/0)     ended by its sibling B  → [0,7]
//     A.1        page 2   (/0/0)   ended by its sibling A.2 → [2,3]
//     A.2        page 4   (/0/1)   ended by its uncle B     → [4,7]
//       A.2.a    page 5   (/0/1/0) ended by an ANCESTOR's next sibling B → [5,7]
//   B            page 8   (/1)     last section → runs to numPages-1
const nested: OutlineEntry[] = [
  {
    title: 'A',
    pageIndex: 0,
    children: [
      { title: 'A.1', pageIndex: 2, children: [] },
      {
        title: 'A.2',
        pageIndex: 4,
        children: [{ title: 'A.2.a', pageIndex: 5, children: [] }],
      },
    ],
  },
  { title: 'B', pageIndex: 8, children: [] },
]

// A null-page parent ("Part" has no dest) whose children still carry pages.
const nullParent: OutlineEntry[] = [
  {
    title: 'Part',
    pageIndex: null,
    children: [
      { title: 'Ch1', pageIndex: 1, children: [] },
      { title: 'Ch2', pageIndex: 3, children: [] },
    ],
  },
  { title: 'Solo', pageIndex: 6, children: [] },
]

describe('flattenOutline', () => {
  it('walks depth-first, pathing each node /<i>/<j> by ORIGINAL index', () => {
    expect(flattenOutline(nested)).toEqual([
      { path: '/0', title: 'A', pageIndex: 0 },
      { path: '/0/0', title: 'A.1', pageIndex: 2 },
      { path: '/0/1', title: 'A.2', pageIndex: 4 },
      { path: '/0/1/0', title: 'A.2.a', pageIndex: 5 },
      { path: '/1', title: 'B', pageIndex: 8 },
    ])
  })

  it('skips null-page nodes but still visits their children (index preserved)', () => {
    expect(flattenOutline(nullParent)).toEqual([
      { path: '/0/0', title: 'Ch1', pageIndex: 1 },
      { path: '/0/1', title: 'Ch2', pageIndex: 3 },
      { path: '/1', title: 'Solo', pageIndex: 6 },
    ])
  })

  it('returns [] for an empty outline', () => {
    expect(flattenOutline([])).toEqual([])
  })
})

describe('tocPageRanges', () => {
  it('owns [start .. next non-descendant start-1]; last section runs to numPages-1', () => {
    const r = tocPageRanges(flattenOutline(nested), 10)
    expect(r.get('/0')).toEqual({ start: 0, end: 7 }) // ended by sibling B
    expect(r.get('/0/0')).toEqual({ start: 2, end: 3 }) // ended by sibling A.2
    expect(r.get('/0/1')).toEqual({ start: 4, end: 7 }) // ended by uncle B
    expect(r.get('/0/1/0')).toEqual({ start: 5, end: 7 }) // ended by ancestor's next sibling
    expect(r.get('/1')).toEqual({ start: 8, end: 9 }) // last → numPages-1
  })

  it('ranges the children of a null-page parent correctly', () => {
    const r = tocPageRanges(flattenOutline(nullParent), 8)
    expect(r.get('/0/0')).toEqual({ start: 1, end: 2 })
    expect(r.get('/0/1')).toEqual({ start: 3, end: 5 })
    expect(r.get('/1')).toEqual({ start: 6, end: 7 })
  })

  it('a single section owns the whole document', () => {
    const r = tocPageRanges([{ path: '/0', title: 'Only', pageIndex: 0 }], 4)
    expect(r.get('/0')).toEqual({ start: 0, end: 3 })
  })

  it('returns an empty map for empty flat input', () => {
    expect(tocPageRanges([], 10).size).toBe(0)
  })
})

describe('findTocPathsForPages', () => {
  const ranges = tocPageRanges(flattenOutline(nested), 10)

  it('prefers the parent section and excludes its covered children', () => {
    // Pages 2,3,5 all live inside A (/0, [0,7]); the greedy parent-first cover picks /0 alone.
    expect(findTocPathsForPages(new Set([2, 3, 5]), ranges)).toEqual(new Set(['/0']))
  })

  it('covers pages spanning two top sections with those two parents', () => {
    expect(findTocPathsForPages(new Set([2, 8]), ranges)).toEqual(new Set(['/0', '/1']))
  })

  it('prunes an already-chosen path\'s children when a parent later subsumes them', () => {
    // Ranges where a CHILD sorts before its parent by localeCompare within the same effective
    // pass is impossible (parents are shallower → sorted first), so the guard prevents a child
    // ever being added under a chosen parent: page 5 is only ever attributed to /0.
    expect(findTocPathsForPages(new Set([5]), ranges)).toEqual(new Set(['/0']))
  })

  it('returns an empty set for no pages or no ranges', () => {
    expect(findTocPathsForPages(new Set(), ranges).size).toBe(0)
    expect(findTocPathsForPages(new Set([2]), new Map()).size).toBe(0)
  })
})

describe('currentTocPath', () => {
  const ranges = tocPageRanges(flattenOutline(nested), 10)

  it('returns the DEEPEST section containing the page', () => {
    expect(currentTocPath(0, ranges)).toBe('/0')
    expect(currentTocPath(2, ranges)).toBe('/0/0')
    expect(currentTocPath(5, ranges)).toBe('/0/1/0') // A, A.2, A.2.a all contain 5 → deepest
    expect(currentTocPath(8, ranges)).toBe('/1')
    expect(currentTocPath(9, ranges)).toBe('/1')
  })

  it('returns null when the page is outside every range', () => {
    expect(currentTocPath(50, ranges)).toBeNull()
  })

  it('returns null for empty ranges', () => {
    expect(currentTocPath(0, new Map())).toBeNull()
  })
})
