/**
 * Obsidian `==highlight==` support as a remark plugin. The transform walks mdast TEXT
 * nodes only, so code spans/blocks are immune by construction (their content lives in
 * `value` of `inlineCode`/`code` leaves, which are never split) — unlike the pinned
 * wiki-link limitation in ./wiki.ts. Mark nodes carry `data.hName: 'mark'`, which
 * remark-rehype turns into a real <mark> element for the NoteView renderer to style.
 */

export interface HighlightSegment {
  type: 'text' | 'mark'
  value: string
}

// Lazy, non-empty body: any non-newline char, where a `=` is allowed only when not part of
// a `==` run (so the FIRST closing marker ends the highlight and `====` never matches).
const HIGHLIGHT = /==((?:[^=\n]|=(?!=))+?)==/g

/** Split a raw text value into text/mark segments; no markers → one text segment. */
export function splitHighlights(value: string): HighlightSegment[] {
  const segments: HighlightSegment[] = []
  let last = 0
  for (const m of value.matchAll(HIGHLIGHT)) {
    if (m.index! > last) segments.push({ type: 'text', value: value.slice(last, m.index) })
    segments.push({ type: 'mark', value: m[1]! })
    last = m.index! + m[0].length
  }
  if (last < value.length || segments.length === 0) {
    segments.push({ type: 'text', value: value.slice(last) })
  }
  return segments
}

/** Minimal structural mdast shapes — enough to walk without depending on @types/mdast. */
interface MdNode {
  type: string
  value?: string
  children?: MdNode[]
  data?: { hName?: string }
}

const toNode = (s: HighlightSegment): MdNode =>
  s.type === 'text'
    ? { type: 'text', value: s.value }
    : {
        type: 'obsidianHighlight',
        data: { hName: 'mark' },
        children: [{ type: 'text', value: s.value }],
      }

function walk(node: MdNode): void {
  if (!node.children) return
  node.children = node.children.flatMap((child) => {
    if (child.type === 'text' && child.value !== undefined) {
      const segments = splitHighlights(child.value)
      // The common no-marker case keeps the original node (no churn).
      if (segments.length === 1 && segments[0]!.type === 'text') return [child]
      return segments.map(toNode)
    }
    walk(child)
    return [child]
  })
}

/** The remark plugin: `remarkPlugins={[..., remarkObsidianHighlight]}`. */
export function remarkObsidianHighlight() {
  return (tree: unknown): void => walk(tree as MdNode)
}
