/**
 * Annotation heat: pure mappings from per-page annotation aggregates to continuous render
 * intensities, and the open-pdf deep-link page rewrite. Kept free of React/pdf.js so it
 * tests as logic (docs/2026-07-13-r1-canvas-heat-zoom-spec §2).
 */

/** The per-page aggregate row the `index:page-annotations` query returns (sans pageIndex). */
export interface PageSubstance {
  count: number
  commented: number
  textChars: number
  commentChars: number
}

// Depth weighting (levels-of-processing): writing a comment is generative processing, so a
// commented annotation outweighs any realistic bare highlight; comment characters outweigh
// highlight characters. BASE keeps text-less annotations (ink/image) from vanishing entirely.
const BASE_PER_ANNOTATION = 10
const COMMENT_CHAR_WEIGHT = 4
const COMMENT_BONUS = 600

/** Substance score for one page — the "depth" heat layer's raw value. */
export function depthValue(p: PageSubstance): number {
  return (
    p.count * BASE_PER_ANNOTATION +
    p.textChars +
    p.commentChars * COMMENT_CHAR_WEIGHT +
    p.commented * COMMENT_BONUS
  )
}

/**
 * Normalize raw per-page values to continuous intensities in (0, 1], relative to THIS
 * document: reference = nearest-rank 95th percentile of the nonzero values (one outlier
 * page must not flatten the rest), values ≥ reference clamp to 1, and a sqrt curve lifts
 * lightly-annotated pages into visibility. Zero-value pages are absent from the map.
 */
export function normalizeHeat(
  values: { pageIndex: number; value: number }[],
): Map<number, number> {
  const intensities = new Map<number, number>()
  const nonzero = values.filter((v) => v.value > 0)
  if (nonzero.length === 0) return intensities
  const sorted = nonzero.map((v) => v.value).sort((a, b) => a - b)
  const reference = sorted[Math.ceil(0.95 * sorted.length) - 1]!
  for (const { pageIndex, value } of nonzero) {
    intensities.set(pageIndex, Math.sqrt(Math.min(value / reference, 1)))
  }
  return intensities
}

/**
 * Rewrite (or append) the `page` parameter of a zotero open-pdf URI to `pageNumber`.
 * The stored URI's `page` is a page *label*, so callers pass the best number they have
 * (pageIndex + 1) — front-matter label offsets are a known limitation, documented at the
 * call site.
 */
export function rewriteOpenPdfPage(openPdfUri: string, pageNumber: number): string {
  const url = new URL(openPdfUri)
  url.searchParams.set('page', String(pageNumber))
  return url.toString()
}
