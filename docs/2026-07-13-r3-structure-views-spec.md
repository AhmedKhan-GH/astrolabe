# R3 — Reader structure: TOC, minimap heat, page-range Views

**Date:** 2026-07-13 · **Track:** R (Reader), phase R3 · **Parent:** `docs/2026-07-13-remaining-work-spec.md` §Track R
**Depends on:** R2 (shipped). **Salvage:** iteration-1 `DocumentViewer.tsx` (`~/Desktop/astrolabe/astrolabe-main/src/components/DocumentViewer.tsx:349,672`) — `buildPageMap` + `findTocPathsForPages`, ported as pure functions with tests (docs/01 §Salvage manifest).

Sub-phases (each ends usable, ADR-0007): **R3a** TOC sidebar + minimap heat → **R3b** page-range
Views (iteration-1's crown jewel) → **R3c** display modes + find-match highlighting (follow-up).

## 1. Pure TOC algorithms (`reader/toc.ts`, TDD — the salvage port)

```ts
export interface OutlineEntry { title: string; pageIndex: number | null; children: OutlineEntry[] }
export interface FlatTocItem { path: string; title: string; pageIndex: number } // path '/0/2'

flattenOutline(entries: OutlineEntry[]): FlatTocItem[]        // depth-first; null-page nodes skipped
tocPageRanges(flat: FlatTocItem[], numPages: number): Map<string, { start: number; end: number }>
  // a node owns [its start .. next NON-DESCENDANT's start − 1], last section runs to numPages−1
  // (iteration-1 buildPageMap, minus the async dest resolution; 0-based, inclusive)
findTocPathsForPages(pages: ReadonlySet<number>, ranges: Map<string, {start,end}>): Set<string>
  // greedy minimal cover, parents preferred; children of a chosen path pruned
  // (iteration-1 findTocPathsForPages, ported behavior-for-behavior)
currentTocPath(pageIndex: number, ranges): string | null      // deepest section containing the page
```

## 2. usePdfDocument addition (FROZEN)

```ts
getOutline?: () => Promise<OutlineEntry[]>  // pdf.js getOutline + dest→pageIndex resolution, cached; [] when none
```

## 3. Page-range Views artifact (main; the reading-state twin)

`src/main/lib/page-views.ts`, one JSON per document at `<workspace>/.astrolabe/page-views/<contentSha256>.json`
(zod, `schemaVersion: 1`, atomic tmp+rename, invalid → absent+warn; hash-keyed like reading-state).

```ts
export interface DocPageView {
  slug: string          // derived from name (shared slugify, views precedent)
  name: string          // 1..120
  pages: number[]       // 0-based pageIndexes, deduped + sorted server-side, 1..5000
  tocPaths?: string[]   // provenance: the TOC cover it was created from (path-string addressing)
  createdAt: string     // ISO
}
```

Channels (documentId in, main resolves hash; hashless/unknown → null, like reading):
```ts
PAGE_VIEWS_LIST_CHANNEL   = 'page-views:list'   // { documentId } → DocPageView[] | null
PAGE_VIEWS_SAVE_CHANNEL   = 'page-views:save'   // { documentId, name, pages, tocPaths? } → DocPageView[] | null (upsert by slug)
PAGE_VIEWS_DELETE_CHANNEL = 'page-views:delete' // { documentId, slug } → DocPageView[] | null
```
Preload: `window.astrolabe.pageViews = { list, save, remove }`. e2e exact-allowlist gains `pageViews`.
Renderer mirror of `DocPageView` in `lens/types.ts`.

## 4. Reader UI (R3a in ReaderView + new `reader/TocSidebar.tsx`, `reader/Minimap.tsx`)

- **TOC sidebar** (toggleable, default open when an outline exists): indented tree, expand/collapse,
  click → scroll to the section's start page; the section containing `currentPage` is highlighted
  live (`currentTocPath`). Checkbox per node (multi-select) — feeds R3b's "save as View".
- **Minimap**: a thin right-edge vertical strip, one sliver per page, tinted by the active heat
  source — `annotations` (breadth via existing `normalizeHeat`) or `read` (dwell) or off — with a
  viewport indicator; click a sliver → scroll to that page. ReaderView therefore gains
  `heat: PageAnnotations | null` as a prop (ReaderHost already can query it; same key as Canvas).
- **R3b Views UI**: header "Views" menu — save current TOC selection (or explicit page set) as a
  named View (`findTocPathsForPages` provides the tocPaths provenance when created from pages);
  applying a View greys out non-member pages in the Reader stack AND (later wiring) the Canvas
  grid; clear-view affordance. Non-member pages stay present (greyed ~35% opacity), preserving
  spatial memory — iteration-1 behavior.

## 5. Ownership (disjoint; agents parallel, targeted tests only)

- **Agent A (main+seam)**: page-views store + unit/itest, db-ipc constants, main/index.ts handlers,
  preload namespace, e2e allowlist line.
- **Agent B (renderer)**: `toc.ts` (+ full TDD of the four functions), `usePdfDocument.getOutline`,
  `TocSidebar.tsx`, `Minimap.tsx`, ReaderView integration of both (sidebar toggle, heat prop,
  minimap, current-section tracking) + component tests; `types.ts` DocPageView mirror.
- **Integrator (main loop)**: R3b Views UI (save/apply/clear, grey-out), ReaderHost heat query +
  pageViews plumbing, Canvas grey-out wiring, gates, commits.

## 6. Tests

unit/pure: the four toc.ts functions (deep nesting, siblings/uncles ending sections, last-section
runs to end, cover-prefers-parents, prune-children, empty sets); page-views merge/slug/sort rules.
components: sidebar tree render/expand/click/current-highlight, minimap slivers + click, Views
menu flows. integration: page-views round-trip/corrupt/hashless. e2e: allowlist `pageViews`.

## 7. Out of scope (R3c, next)

Two-page spread, thumbnail-strip + reading-pane, focus/immersive mode, find-match text-layer
highlighting, Canvas heat minimap.
