/**
 * Obsidian wiki-link → CommonMark rewriting for the read-only NoteView. We do NOT try to
 * resolve targets here (that is the outlinks prop's job); we only turn the four Obsidian
 * link forms into ordinary markdown links under the `astro-wiki://` scheme, which the
 * NoteView `a` renderer intercepts and either navigates (resolved) or greys out (not in
 * vault). Keeping this pure keeps the rewriting fully unit-testable.
 *
 *   [[target]]              → [target](astro-wiki://target)
 *   [[target|alias]]        → [alias](astro-wiki://target)
 *   [[target#heading]]      → [target](astro-wiki://target)   (heading dropped)
 *   [[target#heading|alias]]→ [alias](astro-wiki://target)
 *   ![[embed]]              → [embed](astro-wiki://embed)     (rendered as a link, not an embed)
 *
 * The target is the note name with any `#heading` stripped; it is percent-encoded so
 * spaces/unsafe characters survive as a valid URL. The label is the alias when present,
 * else the (heading-stripped) target.
 */
const WIKI_LINK = /!?\[\[([^\]]+?)\]\]/g

export function wikiLinksToMd(md: string): string {
  return md.replace(WIKI_LINK, (_match, inner: string) => {
    // Only the FIRST `|` separates target from alias; anything after belongs to the alias.
    const [rawTarget, ...aliasParts] = inner.split('|')
    const alias = aliasParts.join('|').trim()
    // The target is everything before the first `#` (the heading anchor is dropped).
    const target = rawTarget.split('#')[0]!.trim()
    const label = alias.length > 0 ? alias : target
    return `[${label}](astro-wiki://${encodeURIComponent(target)})`
  })
}

/**
 * Strip a single leading YAML frontmatter block (`---` … `---`) if present. Anything else —
 * a `---` horizontal rule mid-document, or an unterminated opening fence — is left intact.
 */
const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---[^\S\r\n]*(?:\r?\n|$)/

export function stripFrontmatter(md: string): string {
  return md.replace(FRONTMATTER, '')
}
