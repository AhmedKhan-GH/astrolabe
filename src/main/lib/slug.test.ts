import { describe, it, expect } from 'vitest'
import { slugify } from './slug'

/**
 * Unit tier for the shared slug derivation (docs/2026-07-10-lens-virtual-collections-spec
 * §Testing: "slug extraction unchanged-behaviour"). This is the function views.ts and
 * vcollections.ts both bind — the normalisation (case, punctuation runs, non-ascii, empty
 * guard) is the branching worth pinning, plus the caller-supplied fallback.
 */
describe('slugify', () => {
  it('lowercases and hyphenates spacing', () => {
    expect(slugify('My View')).toBe('my-view')
    expect(slugify('UPPER Case')).toBe('upper-case')
  })

  it('collapses non-alphanumeric runs to a single dash', () => {
    expect(slugify('ML/AI & Design')).toBe('ml-ai-design')
    expect(slugify('a  --  b')).toBe('a-b')
  })

  it('trims leading and trailing dashes', () => {
    expect(slugify('  trim  ')).toBe('trim')
    expect(slugify('!leading')).toBe('leading')
  })

  it('drops non-ascii characters', () => {
    expect(slugify('Café Notes')).toBe('caf-notes')
  })

  it('falls back to the caller-supplied default when the slug would be empty', () => {
    expect(slugify('!!!')).toBe('item') // default fallback
    expect(slugify('   ', 'collection')).toBe('collection')
    expect(slugify('日本語', 'view')).toBe('view')
  })
})
