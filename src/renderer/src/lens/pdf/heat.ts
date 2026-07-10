/**
 * Annotation heat: pure mapping from per-page annotation counts to render tiers, and
 * the open-pdf deep-link page rewrite. Kept free of React/pdf.js so it tests as logic.
 */

/** Stepped intensity for the heat overlay: none (0), t1 (1), t2 (2–3), t3 (≥4). */
export type HeatTier = 'none' | 't1' | 't2' | 't3'

export function countToTier(count: number): HeatTier {
  if (count >= 4) return 't3'
  if (count >= 2) return 't2'
  if (count >= 1) return 't1'
  return 'none'
}

/** pageIndex → tier lookup; pages with no annotations are simply absent (→ 'none'). */
export function countsToTiers(
  pages: { pageIndex: number; count: number }[],
): Map<number, HeatTier> {
  const tiers = new Map<number, HeatTier>()
  for (const { pageIndex, count } of pages) {
    const tier = countToTier(count)
    if (tier !== 'none') tiers.set(pageIndex, tier)
  }
  return tiers
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
