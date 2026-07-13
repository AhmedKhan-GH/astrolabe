import { describe, it, expect } from 'vitest'
import {
  dedupeSortPages,
  upsertView,
  slugify,
  savePageViewRequestSchema,
  deletePageViewRequestSchema,
  type DocPageView,
} from './page-views'

/**
 * Unit tier for the page-range Views store (docs/2026-07-13-r3-structure-views-spec §3): the pure
 * merge rules are the branching worth pinning — pages are deduped + sorted server-side, upsert is
 * BY SLUG (same name replaces pages/tocPaths but keeps the original createdAt), and the list stays
 * createdAt-ascending. Plus the frozen wire bounds (§3): empty pages rejected, name 1..120, etc.
 */

const NOW = Date.parse('2026-07-13T12:00:00.000Z')

describe('dedupeSortPages', () => {
  it('removes duplicates and sorts ascending', () => {
    expect(dedupeSortPages([5, 1, 5, 3, 1, 0])).toEqual([0, 1, 3, 5])
  })

  it('leaves an already-sorted unique list unchanged', () => {
    expect(dedupeSortPages([0, 2, 4])).toEqual([0, 2, 4])
  })
})

describe('slugify (bound to the `view` fallback)', () => {
  it('kebab-cases a name', () => {
    expect(slugify('Intro & Chapter 1')).toBe('intro-chapter-1')
  })

  it('falls back to `view` when the name has no slug-able characters', () => {
    expect(slugify('!!!')).toBe('view')
  })
})

describe('upsertView', () => {
  it('creates a view: derived slug, deduped+sorted pages, createdAt = now', () => {
    const next = upsertView([], { name: 'My View', pages: [3, 1, 3, 0] }, NOW)
    expect(next).toHaveLength(1)
    expect(next[0]).toEqual({
      slug: 'my-view',
      name: 'My View',
      pages: [0, 1, 3],
      createdAt: new Date(NOW).toISOString(),
    })
  })

  it('carries tocPaths through when provided, omits the key when absent', () => {
    const withPaths = upsertView([], { name: 'A', pages: [0], tocPaths: ['/0', '/0/1'] }, NOW)
    expect(withPaths[0].tocPaths).toEqual(['/0', '/0/1'])
    const without = upsertView([], { name: 'B', pages: [0] }, NOW)
    expect(without[0]).not.toHaveProperty('tocPaths')
  })

  it('upserts by slug: a same-name save replaces pages/tocPaths but keeps the original createdAt', () => {
    const t0 = Date.parse('2026-07-13T10:00:00.000Z')
    const first = upsertView([], { name: 'Chapter 1', pages: [0, 1] }, t0)
    const second = upsertView(first, { name: 'Chapter 1', pages: [5, 2] }, NOW)
    expect(second).toHaveLength(1)
    expect(second[0].pages).toEqual([2, 5])
    expect(second[0].createdAt).toBe(new Date(t0).toISOString()) // original kept
  })

  it('keeps distinct names as separate views, createdAt-ascending', () => {
    const t0 = Date.parse('2026-07-13T10:00:00.000Z')
    const t1 = Date.parse('2026-07-13T11:00:00.000Z')
    const one = upsertView([], { name: 'Beta', pages: [0] }, t1)
    const two = upsertView(one, { name: 'Alpha', pages: [1] }, t0)
    // Alpha was created earlier (t0) so it sorts first despite being saved second.
    expect(two.map((v) => v.name)).toEqual(['Alpha', 'Beta'])
  })

  it('does not mutate the input array', () => {
    const views: DocPageView[] = []
    upsertView(views, { name: 'X', pages: [0] }, NOW)
    expect(views).toEqual([])
  })
})

describe('savePageViewRequestSchema (frozen wire bounds §3)', () => {
  const ok = { documentId: 1, name: 'A View', pages: [0, 1] }

  it('accepts a valid request', () => {
    expect(savePageViewRequestSchema.parse(ok).pages).toEqual([0, 1])
  })

  it('rejects an empty pages array', () => {
    expect(() => savePageViewRequestSchema.parse({ ...ok, pages: [] })).toThrow()
  })

  it('rejects more than 5000 pages', () => {
    const pages = Array.from({ length: 5001 }, (_, i) => i)
    expect(() => savePageViewRequestSchema.parse({ ...ok, pages })).toThrow()
  })

  it('rejects a negative pageIndex', () => {
    expect(() => savePageViewRequestSchema.parse({ ...ok, pages: [-1] })).toThrow()
  })

  it('rejects an empty name and a name longer than 120', () => {
    expect(() => savePageViewRequestSchema.parse({ ...ok, name: '' })).toThrow()
    expect(() => savePageViewRequestSchema.parse({ ...ok, name: 'x'.repeat(121) })).toThrow()
  })

  it('rejects more than 500 tocPaths', () => {
    const tocPaths = Array.from({ length: 501 }, () => '/0')
    expect(() => savePageViewRequestSchema.parse({ ...ok, tocPaths })).toThrow()
  })

  it('rejects a non-positive documentId', () => {
    expect(() => savePageViewRequestSchema.parse({ ...ok, documentId: 0 })).toThrow()
  })
})

describe('deletePageViewRequestSchema', () => {
  it('accepts a documentId + slug', () => {
    expect(deletePageViewRequestSchema.parse({ documentId: 1, slug: 'my-view' }).slug).toBe('my-view')
  })

  it('rejects an empty slug', () => {
    expect(() => deletePageViewRequestSchema.parse({ documentId: 1, slug: '' })).toThrow()
  })
})
