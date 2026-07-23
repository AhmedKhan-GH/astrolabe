import matter from 'gray-matter'

/**
 * Pure Obsidian markdown → note-shape parsing (runway step 8; docs/03 Layer 2).
 * Zero fs / zero network: `parseNote` takes the raw file text and returns the
 * extracted shape. `index.ts` is what stats the file, builds the URI, and upserts.
 * Keeping this pure is what lets the whole extraction be fixture-driven (parser.test.ts).
 *
 * Extraction rules (best-effort, matching Obsidian's own conventions):
 *  - Frontmatter via gray-matter (YAML). `tags`/`tag` may be a YAML list OR a
 *    comma/space-delimited string; a leading '#' is stripped. `aliases`/`alias`
 *    likewise (but NOT split on spaces — an alias may contain spaces).
 *  - Inline #tags: letters/numbers/`_`/`-`/`/` (nested), unicode-aware, must not be
 *    purely numeric. Extracted from the body with fenced + inline code removed first.
 *  - [[wiki-links]]: the target is the text before the first '|' (alias) or '#'
 *    (heading/block-ref); embeds `![[…]]` count. Deduped, order preserved. Stored for
 *    the Phase-2 backlink edges.
 *  - Blockquotes: each contiguous run of Markdown `>` lines is one annotation.
 *    The quote marker is removed, quote-prefixed blank lines preserve paragraphs,
 *    and fenced code blocks are excluded.
 */

export interface ParsedNote {
  /** Frontmatter `title`, else the first alias, else null (connector → basename). */
  title: string | null
  /** Frontmatter tags ∪ inline #tags, '#'-stripped, deduped, order preserved. */
  tags: string[]
  /** Frontmatter aliases (order preserved). */
  aliases: string[]
  /** Wiki-link targets (for future backlink edges), deduped, order preserved. */
  wikiLinks: string[]
  /** Contiguous Markdown blockquotes, marker-stripped, in source order. */
  blockquotes: string[]
  /** The keys present in the frontmatter block (for metaJson). */
  frontmatterKeys: string[]
  /** Markdown body with the frontmatter block removed. */
  body: string
}

/** Strip a single leading '#' (frontmatter tags are sometimes written `#tag`). */
function stripHash(value: string): string {
  return value.startsWith('#') ? value.slice(1) : value
}

/** Frontmatter tags → string[]: YAML list, or a comma/whitespace-delimited string. */
function normalizeTags(value: unknown): string[] {
  const raw = Array.isArray(value)
    ? value.map((v) => String(v))
    : typeof value === 'string'
      ? value.split(/[,\s]+/)
      : []
  return raw.map((t) => stripHash(t.trim())).filter((t) => t.length > 0)
}

/** Frontmatter aliases → string[]: YAML list, or a single string (spaces preserved). */
function normalizeAliases(value: unknown): string[] {
  const raw = Array.isArray(value) ? value.map((v) => String(v)) : typeof value === 'string' ? [value] : []
  return raw.map((a) => a.trim()).filter((a) => a.length > 0)
}

/** Remove fenced (``` / ~~~) blocks and inline `code` spans so they don't yield tags/links. */
function stripCode(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/~~~[\s\S]*?~~~/g, ' ')
    .replace(/`[^`\n]*`/g, ' ')
}

// A tag: preceded by start/whitespace/`(`, then #, then the tag chars. Unicode letters
// allowed. `\p{L}` catches non-ASCII; `_ - /` for word-joins and nesting.
const INLINE_TAG_RE = /(?:^|[\s(])#([\p{L}\p{N}_/-]+)/gu
const WIKILINK_RE = /!?\[\[([^\]]+?)\]\]/g

/** Inline #tags from already-code-stripped text; drops purely-numeric matches. */
function extractInlineTags(strippedBody: string): string[] {
  const out: string[] = []
  for (const m of strippedBody.matchAll(INLINE_TAG_RE)) {
    const tag = m[1]
    if (tag && !/^\d+$/.test(tag)) out.push(tag)
  }
  return out
}

/** [[target|alias]] / [[target#heading]] → `target`, from already-code-stripped text. */
function extractWikiLinks(strippedBody: string): string[] {
  const out: string[] = []
  for (const m of strippedBody.matchAll(WIKILINK_RE)) {
    const inner = m[1]
    if (!inner) continue
    const target = inner.split('|')[0]!.split('#')[0]!.trim()
    if (target.length > 0) out.push(target)
  }
  return out
}

/** Markdown blockquotes outside fenced code, grouped by contiguous `>` lines. */
function extractBlockquotes(body: string): string[] {
  const out: string[] = []
  let current: string[] | null = null
  let fence: { marker: '`' | '~'; length: number } | null = null

  const flush = (): void => {
    if (current === null) return
    const text = current.join('\n').trim()
    if (text.length > 0) out.push(text)
    current = null
  }

  for (const line of body.split(/\r?\n/)) {
    if (fence !== null) {
      const close = line.match(/^ {0,3}(`{3,}|~{3,})\s*$/)
      if (close?.[1]?.[0] === fence.marker && close[1].length >= fence.length) fence = null
      continue
    }

    const open = line.match(/^ {0,3}(`{3,}|~{3,})/)
    if (open?.[1]) {
      flush()
      fence = {
        marker: open[1][0] as '`' | '~',
        length: open[1].length,
      }
      continue
    }

    const quote = line.match(/^ {0,3}>\s?(.*)$/)
    if (quote) {
      current ??= []
      current.push(quote[1] ?? '')
    } else {
      flush()
    }
  }
  flush()
  return out
}

/** De-dupe preserving first-seen order. */
function dedupe(values: string[]): string[] {
  return [...new Set(values)]
}

export function parseNote(raw: string): ParsedNote {
  const parsed = matter(raw)
  const data = parsed.data as Record<string, unknown>
  const body = parsed.content

  const frontmatterKeys = Object.keys(data)
  const aliases = normalizeAliases(data['aliases'] ?? data['alias'])
  const fmTags = normalizeTags(data['tags'] ?? data['tag'])

  const stripped = stripCode(body)
  const inlineTags = extractInlineTags(stripped)
  const wikiLinks = dedupe(extractWikiLinks(stripped))
  const blockquotes = extractBlockquotes(body)

  const rawTitle = data['title']
  const title = typeof rawTitle === 'string' && rawTitle.trim().length > 0 ? rawTitle.trim() : (aliases[0] ?? null)

  return {
    title,
    tags: dedupe([...fmTags, ...inlineTags]),
    aliases,
    wikiLinks,
    blockquotes,
    frontmatterKeys,
    body: body.trim(),
  }
}
