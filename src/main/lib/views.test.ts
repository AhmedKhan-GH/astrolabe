import { describe, it, expect } from 'vitest'
import { slugify } from './views'

/**
 * Unit tier for the saved-view slug derivation (docs/2026-07-10-lens-saved-views-spec
 * §Testing). Slug is the file identity and the upsert key, so its normalisation — case,
 * spacing, punctuation runs, non-ascii, empty guard — is the branching worth pinning.
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

  it('falls back to "view" when the slug would be empty', () => {
    expect(slugify('!!!')).toBe('view')
    expect(slugify('   ')).toBe('view')
    expect(slugify('日本語')).toBe('view')
  })
})
