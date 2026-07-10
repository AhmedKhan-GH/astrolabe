import { describe, it, expect } from 'vitest'
import { wikiLinksToMd, stripFrontmatter } from './wiki'

describe('wikiLinksToMd', () => {
  it('rewrites a bare [[target]] to an astro-wiki link labelled by the target', () => {
    expect(wikiLinksToMd('see [[Note]] here')).toBe('see [Note](astro-wiki://Note) here')
  })

  it('uses the alias as the label for [[target|alias]] (target still the link)', () => {
    expect(wikiLinksToMd('[[Note|Nice Name]]')).toBe('[Nice Name](astro-wiki://Note)')
  })

  it('strips the #heading from both the target and the label', () => {
    expect(wikiLinksToMd('[[Note#Section]]')).toBe('[Note](astro-wiki://Note)')
  })

  it('strips the #heading but keeps the alias when both are present', () => {
    expect(wikiLinksToMd('[[Note#Section|Alias]]')).toBe('[Alias](astro-wiki://Note)')
  })

  it('rewrites an ![[embed]] as a plain link (the ! is dropped)', () => {
    expect(wikiLinksToMd('![[Diagram]]')).toBe('[Diagram](astro-wiki://Diagram)')
  })

  it('percent-encodes spaces and unsafe chars in the target', () => {
    expect(wikiLinksToMd('[[My Note]]')).toBe('[My Note](astro-wiki://My%20Note)')
  })

  it('rewrites every occurrence in a line', () => {
    expect(wikiLinksToMd('[[A]] and [[B|bee]]')).toBe(
      '[A](astro-wiki://A) and [bee](astro-wiki://B)',
    )
  })

  it('leaves ordinary markdown untouched', () => {
    const md = '# Title\n\n[real](https://x.test) and `code`'
    expect(wikiLinksToMd(md)).toBe(md)
  })

  // Pinned behaviour: code-span immunity is not implemented (a naive global rewrite is
  // cheap and correct for the overwhelmingly common case). A wiki link written inside a
  // code span is still rewritten. This test documents that deliberate limitation so a
  // future change to it is a conscious decision, not an accident.
  it('does NOT protect wiki links inside code spans (pinned current behaviour)', () => {
    expect(wikiLinksToMd('`[[Note]]`')).toBe('`[Note](astro-wiki://Note)`')
  })
})

describe('stripFrontmatter', () => {
  it('removes a leading --- YAML block', () => {
    expect(stripFrontmatter('---\ntitle: X\ntags: [a, b]\n---\n# Body')).toBe('# Body')
  })

  it('leaves a document without frontmatter unchanged', () => {
    expect(stripFrontmatter('# Body\n\ntext')).toBe('# Body\n\ntext')
  })

  it('only strips a LEADING block — a --- rule later in the doc survives', () => {
    expect(stripFrontmatter('text\n\n---\nmore')).toBe('text\n\n---\nmore')
  })

  it('does not strip when the opening --- has no closing fence', () => {
    expect(stripFrontmatter('---\ntitle: X\n# Body')).toBe('---\ntitle: X\n# Body')
  })
})
