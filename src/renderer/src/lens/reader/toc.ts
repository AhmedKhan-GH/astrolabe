/**
 * Pure TOC algorithms (docs/2026-07-13-r3-structure-views-spec §1) — the salvage port of
 * iteration-1's `DocumentViewer.buildPageMap` + `findTocPathsForPages`, reimplemented as
 * DOM-free, pdf.js-free functions on 0-based inclusive page ranges. The async dest→pageIndex
 * resolution lives in `usePdfDocument.getOutline`; these operate on the already-resolved tree.
 */

/** One outline node: a page-less node (`pageIndex === null`) is a heading with no destination. */
export interface OutlineEntry {
  title: string
  pageIndex: number | null
  children: OutlineEntry[]
}

/** A flattened, page-bearing outline node. `path` is `/<i>/<j>…` by ORIGINAL child index. */
export interface FlatTocItem {
  path: string
  title: string
  pageIndex: number
}

/** Inclusive 0-based page span a section owns. */
export interface TocRange {
  start: number
  end: number
}

/** True when `path` is a strict descendant of `ancestor` (`/0/1` is under `/0`, `/10` is not). */
const isDescendant = (path: string, ancestor: string): boolean => path.startsWith(ancestor + '/')

/** Path depth = number of `/`-separated segments (`/0` → 1, `/0/1` → 2). */
const depthOf = (path: string): number => path.split('/').filter(Boolean).length

/**
 * Depth-first flatten. Every node is addressed by its ORIGINAL index at each level (so paths
 * are stable regardless of how many siblings lack a destination); page-less nodes are omitted
 * from the result but their children are still visited and pathed under them.
 */
export function flattenOutline(entries: OutlineEntry[]): FlatTocItem[] {
  const out: FlatTocItem[] = []
  const walk = (items: OutlineEntry[], parentPath: string): void => {
    items.forEach((item, i) => {
      const path = `${parentPath}/${i}`
      if (item.pageIndex !== null) out.push({ path, title: item.title, pageIndex: item.pageIndex })
      if (item.children.length > 0) walk(item.children, path)
    })
  }
  walk(entries, '')
  return out
}

/**
 * Each section owns `[its start .. the next NON-DESCENDANT section's start − 1]` — i.e. it runs
 * until the next thing that isn't one of its own subsections begins (a sibling, an uncle, or any
 * ancestor's next sibling, whichever comes first in reading order). The last section runs to the
 * final page (`numPages − 1`). (iteration-1 `buildPageMap`, minus the async dest resolution.)
 */
export function tocPageRanges(flat: FlatTocItem[], numPages: number): Map<string, TocRange> {
  const ranges = new Map<string, TocRange>()
  for (const item of flat) {
    const start = item.pageIndex
    let end = numPages - 1
    for (const other of flat) {
      if (other.path === item.path || other.pageIndex <= start) continue
      if (!isDescendant(other.path, item.path)) {
        end = other.pageIndex - 1
        break
      }
    }
    ranges.set(item.path, { start, end })
  }
  return ranges
}

/**
 * Greedy minimal cover of `pages` by TOC sections, preferring the broadest (shallowest)
 * sections first so a fully-covered subtree collapses to its parent; children of an
 * already-chosen path are never added, and any child added earlier is pruned once its parent
 * is chosen. (iteration-1 `findTocPathsForPages`, ported behavior-for-behavior.)
 */
export function findTocPathsForPages(
  pages: ReadonlySet<number>,
  ranges: Map<string, TocRange>,
): Set<string> {
  const chosen = new Set<string>()
  if (pages.size === 0 || ranges.size === 0) return chosen
  const items = Array.from(ranges.entries())
    .map(([path, r]) => ({ path, start: r.start, end: r.end, level: depthOf(path) }))
    // Shallowest (parent) sections first; path order breaks ties deterministically.
    .sort((a, b) => (a.level !== b.level ? a.level - b.level : a.path.localeCompare(b.path)))
  const uncovered = new Set(pages)
  for (const item of items) {
    if (uncovered.size === 0) break
    let covers = 0
    for (const p of uncovered) if (p >= item.start && p <= item.end) covers++
    if (covers === 0) continue
    if (Array.from(chosen).some((sel) => isDescendant(item.path, sel))) continue
    chosen.add(item.path)
    for (const p of Array.from(uncovered)) if (p >= item.start && p <= item.end) uncovered.delete(p)
    for (const sel of Array.from(chosen)) if (isDescendant(sel, item.path)) chosen.delete(sel)
  }
  return chosen
}

/**
 * The deepest section whose range contains `pageIndex`, or null when the page is outside every
 * section (front matter before the first entry, or a document with no outline). Ties at equal
 * depth resolve to the lexicographically-earlier path for determinism.
 */
export function currentTocPath(pageIndex: number, ranges: Map<string, TocRange>): string | null {
  let best: string | null = null
  let bestDepth = -1
  for (const [path, r] of ranges) {
    if (pageIndex < r.start || pageIndex > r.end) continue
    const d = depthOf(path)
    if (d > bestDepth || (d === bestDepth && best !== null && path.localeCompare(best) < 0)) {
      best = path
      bestDepth = d
    }
  }
  return best
}
