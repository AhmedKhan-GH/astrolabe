/**
 * Pure in-document page matcher (docs/2026-07-13-r2-reader-reading-state-spec §3). Case-
 * insensitive substring count per page over the reader's lazily-fetched page texts; a page
 * whose text hasn't been fetched yet is `null` and is simply skipped (not a zero-hit). R2 is
 * page-level only — the find bar shows which pages hit and how many; in-text highlighting is
 * R3. An empty query matches nothing.
 */

export interface PageHit {
  pageIndex: number
  count: number
}

export function searchPages(texts: (string | null)[], q: string): PageHit[] {
  if (q === '') return []
  const needle = q.toLowerCase()
  const hits: PageHit[] = []
  texts.forEach((text, pageIndex) => {
    if (text == null) return
    const hay = text.toLowerCase()
    let count = 0
    let from = hay.indexOf(needle)
    while (from !== -1) {
      count++
      from = hay.indexOf(needle, from + needle.length)
    }
    if (count > 0) hits.push({ pageIndex, count })
  })
  return hits
}
