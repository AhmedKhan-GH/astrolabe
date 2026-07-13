/**
 * Find-match highlighting inside the pdf.js text layer via the CSS Custom Highlight API
 * (docs/2026-07-13-r3c-reader-completion-spec §Scope 4). Two halves:
 *
 *  - `mapMatchesToSpans` — PURE offset mapping (unit-tested). pdf.js lays each text run as its own
 *    absolute-positioned <span>; we concatenate those runs DIRECTLY (no injected separators) and
 *    find case-insensitive, non-overlapping occurrences of the query in the concatenation, then
 *    map each match back to the per-span character slices it covers. Matches may cross span
 *    boundaries. The caller derives its `spanTexts` from the SAME span set in the SAME order, so
 *    the returned offsets index straight into those spans' text nodes.
 *
 *  - `applyHighlights` / `clearHighlights` — the DOM side. Builds Ranges over the spans' text
 *    nodes and registers two document-global `Highlight`s: `astro-find` (every match) and
 *    `astro-find-active` (the active one). jsdom has no `CSS.highlights` → guarded no-op, which is
 *    why the pure mapping is what the unit tests pin.
 *
 * CONSISTENCY NOTE: the find bar's match COUNTS come from `searchPages` over `getPageText` (items
 * joined, EOLs inserted). This span concatenation can differ from that text (whitespace/ordering),
 * so the highlighted occurrences may not perfectly equal the counted ones. We do NOT force them
 * equal — the count is the source of truth for navigation; highlighting is best-effort per page.
 */

export interface SpanSlice {
  spanIndex: number
  start: number
  end: number
}

export function mapMatchesToSpans(spanTexts: string[], query: string): SpanSlice[][] {
  if (query === '' || spanTexts.length === 0) return []
  const needle = query.toLowerCase()
  const haystack = spanTexts.join('').toLowerCase()

  // Each span's start offset in the concatenated coordinate space.
  const spanStarts: number[] = []
  let acc = 0
  for (const text of spanTexts) {
    spanStarts.push(acc)
    acc += text.length
  }

  const result: SpanSlice[][] = []
  let from = haystack.indexOf(needle)
  while (from !== -1) {
    const matchStart = from
    const matchEnd = from + needle.length
    const slices: SpanSlice[] = []
    for (let i = 0; i < spanTexts.length; i++) {
      const spanStart = spanStarts[i]!
      const spanEnd = spanStart + spanTexts[i]!.length
      const lo = Math.max(matchStart, spanStart)
      const hi = Math.min(matchEnd, spanEnd)
      // Boundary rule: only a NON-EMPTY intersection produces a slice — a match ending exactly on
      // a boundary emits no zero-width slice for the next span, and empty spans are skipped.
      if (lo < hi) slices.push({ spanIndex: i, start: lo - spanStart, end: hi - spanStart })
    }
    result.push(slices)
    from = haystack.indexOf(needle, matchEnd) // non-overlapping, matches searchPages semantics
  }
  return result
}

/** The text-bearing spans of a pdf.js text layer, in document order (markedContent wrappers are
 *  structural — `display: contents` — and excluded). Both `readSpanTexts` and `applyHighlights`
 *  use this selector so their span indices agree. */
const SPAN_SELECTOR = 'span:not(.markedContent)'

/** The concatenation inputs for `mapMatchesToSpans`, read from a live text-layer element. */
export function readSpanTexts(textLayerEl: HTMLElement): string[] {
  return Array.from(textLayerEl.querySelectorAll<HTMLElement>(SPAN_SELECTOR)).map(
    (s) => s.textContent ?? '',
  )
}

const HIGHLIGHT_NAME = 'astro-find'
const ACTIVE_NAME = 'astro-find-active'

/**
 * `CSS.highlights` is a single document-global registry, but the Reader highlights per page (one
 * text layer at a time). We keep each layer's Ranges here and rebuild the two global Highlights
 * from ALL layers, so pages never clobber one another. Disconnected layers are pruned on rebuild.
 */
const perLayer = new Map<HTMLElement, { all: Range[]; active: Range[] }>()

function highlightsUnavailable(): boolean {
  return typeof CSS === 'undefined' || !CSS.highlights
}

function rebuild(): void {
  const all = new Highlight()
  const active = new Highlight()
  for (const [el, sets] of perLayer) {
    if (!el.isConnected) {
      perLayer.delete(el)
      continue
    }
    for (const r of sets.all) all.add(r)
    for (const r of sets.active) active.add(r)
  }
  CSS.highlights.set(HIGHLIGHT_NAME, all)
  CSS.highlights.set(ACTIVE_NAME, active)
}

/**
 * Register this text layer's highlight Ranges. `slicesPerMatch` is this page's own matches (from
 * `mapMatchesToSpans` over this layer's spans); `activeIndex` selects which of those matches is the
 * active one (into the `astro-find-active` registry) — pass a value outside `[0, length)` (e.g. -1)
 * for pages that don't hold the active match. Called with empty slices to clear just this page.
 */
export function applyHighlights(
  textLayerEl: HTMLElement,
  slicesPerMatch: SpanSlice[][],
  activeIndex: number,
): void {
  if (highlightsUnavailable()) return
  const spans = Array.from(textLayerEl.querySelectorAll<HTMLElement>(SPAN_SELECTOR))
  const all: Range[] = []
  const active: Range[] = []
  slicesPerMatch.forEach((slices, matchIndex) => {
    for (const slice of slices) {
      const node = spans[slice.spanIndex]?.firstChild
      if (!node) continue
      const range = new Range()
      try {
        range.setStart(node, slice.start)
        range.setEnd(node, slice.end)
      } catch {
        continue // a span whose text node is shorter than expected — skip that fragment
      }
      all.push(range)
      if (matchIndex === activeIndex) active.push(range)
    }
  })
  perLayer.set(textLayerEl, { all, active })
  rebuild()
}

/** Remove every find highlight (all pages). Called when the find bar closes or the query empties. */
export function clearHighlights(): void {
  perLayer.clear()
  if (highlightsUnavailable()) return
  CSS.highlights.delete(HIGHLIGHT_NAME)
  CSS.highlights.delete(ACTIVE_NAME)
}
