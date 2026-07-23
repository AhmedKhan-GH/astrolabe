import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parseNote } from './parser'

/**
 * Tier A unit: the Obsidian markdown → note-shape parser is PURE (no fs, no net),
 * so it is driven from the same synthetic mini-vault fixtures the integration test
 * scans. We prove every extraction rule: frontmatter tags/aliases/title, inline
 * #tags with code-block exclusion, [[wiki-link]] target extraction (alias + heading
 * stripping, dedupe), and the frontmatter/body split.
 */
function fixture(rel: string): string {
  return readFileSync(fileURLToPath(new URL(`./__fixtures__/vault/${rel}`, import.meta.url)), 'utf8')
}

describe('parseNote — frontmatter', () => {
  const note = parseNote(fixture('frontmatter-tags.md'))

  it('reads the frontmatter title', () => {
    expect(note.title).toBe('Quantum Field Theory Notes')
  })

  it('reads array-form frontmatter tags and merges inline tags', () => {
    // frontmatter [physics, quantum, field-theory] + inline #renormalization
    expect(note.tags).toEqual(['physics', 'quantum', 'field-theory', 'renormalization'])
  })

  it('reads aliases (list form, spaces preserved)', () => {
    expect(note.aliases).toEqual(['QFT', 'Quantum Fields'])
  })

  it('records the frontmatter keys that were present', () => {
    expect(note.frontmatterKeys.sort()).toEqual(['aliases', 'tags', 'title'])
  })

  it('extracts wiki-link targets from the body', () => {
    expect(note.wikiLinks).toEqual(['Peskin and Schroeder'])
  })

  it('body excludes the frontmatter block', () => {
    expect(note.body).not.toContain('title:')
    expect(note.body).toContain('running of coupling constants')
  })
})

describe('parseNote — inline tags with code exclusion', () => {
  const note = parseNote(fixture('inline-tags.md'))

  it('extracts inline tags including nested (slash) tags', () => {
    expect(note.tags).toEqual(['machine-learning', 'nlp/transformers', 'project/astrolabe'])
  })

  it('ignores tags inside fenced code blocks', () => {
    expect(note.tags).not.toContain('not-a-real-tag')
  })

  it('ignores tags inside inline code spans', () => {
    expect(note.tags).not.toContain('alsofake')
  })

  it('ignores bare-number "tags"', () => {
    expect(note.tags).not.toContain('2024')
  })
})

describe('parseNote — wiki-links', () => {
  const note = parseNote(fixture('wikilinks.md'))

  it('strips alias (|) and heading (#) suffixes, dedupes, keeps embeds', () => {
    expect(note.wikiLinks).toEqual([
      'Deep Learning',
      'Attention Is All You Need',
      'Neural Networks',
      'architecture-diagram.png',
    ])
  })
})

describe('parseNote — no frontmatter', () => {
  const note = parseNote(fixture('no-frontmatter.md'))

  it('has a null title (connector falls back to basename) and empty frontmatter keys', () => {
    expect(note.title).toBeNull()
    expect(note.frontmatterKeys).toEqual([])
  })

  it('still extracts inline tags and wiki-links', () => {
    expect(note.tags).toEqual(['plain'])
    expect(note.wikiLinks).toEqual(['Somewhere'])
  })
})

describe('parseNote — nested note (string-form tags, alias-as-title)', () => {
  const note = parseNote(fixture('projects/nested-note.md'))

  it('splits comma/space-delimited string tags and merges inline', () => {
    expect(note.tags).toEqual(['nested', 'single-string', 'deep'])
  })

  it('falls back title to the first alias when no title key', () => {
    expect(note.title).toBe('NestedAlias')
    expect(note.aliases).toEqual(['NestedAlias'])
  })
})

describe('parseNote — blockquote annotations', () => {
  it('groups contiguous quote lines, strips markers, and ignores fenced code', () => {
    const note = parseNote([
      'Before the quotes.',
      '> First annotation, first line.',
      '> continued on the next line.',
      '>',
      '> A second paragraph in the same annotation.',
      '',
      'Ordinary prose separates annotations.',
      '> Second annotation.',
      '',
      '```md',
      '> This is code, not an annotation.',
      '```',
      '   > Up to three leading spaces are valid Markdown.',
    ].join('\n'))

    expect(note.blockquotes).toEqual([
      'First annotation, first line.\ncontinued on the next line.\n\nA second paragraph in the same annotation.',
      'Second annotation.',
      'Up to three leading spaces are valid Markdown.',
    ])
  })
})

describe('parseNote — degenerate input', () => {
  it('handles an empty string without throwing', () => {
    const note = parseNote('')
    expect(note.title).toBeNull()
    expect(note.tags).toEqual([])
    expect(note.wikiLinks).toEqual([])
    expect(note.aliases).toEqual([])
    expect(note.frontmatterKeys).toEqual([])
    expect(note.blockquotes).toEqual([])
  })

  it('strips a leading "#" from frontmatter tags', () => {
    const note = parseNote('---\ntags: ["#foo", bar]\n---\nbody')
    expect(note.tags).toEqual(['foo', 'bar'])
  })
})
