# R2 — Continuous-scroll Reader + reading-state (exposure)

**Date:** 2026-07-13 · **Track:** R (Reader), phase R2 · **Parent:** `docs/2026-07-13-remaining-work-spec.md` §Track R
**Depends on:** R1 (shipped: continuous heat + `pdf/zoom.ts`). **Feeds:** Track L (forgetting curve), R3 (heat across modes).

A real reading surface: stacked pages with a pdf.js text layer (selection + in-document
search), plus persisted **reading-state** — per-page exposure (dwell + visits + timestamps)
as a first-party artifact. Honest framing everywhere: this measures **engagement**, never
"understood" (pedagogy spec §upstream note); the shape is chosen to feed a forgetting curve
(per-page dwell, timestamps, finished marker).

## 1. Reading-state artifact (main)

`src/main/lib/reading-state.ts`, one JSON per document at
`<workspace>/.astrolabe/reading/<contentSha256>.json` (views precedent: zod-validated,
schemaVersion, atomic tmp+rename write, invalid file → treated absent + warn). Keyed by
content hash so the same PDF in Eagle+Zotero accrues ONE state and a rebuild never loses it.

```ts
export interface PageExposure {
  dwellMs: number      // accumulated in-view, window-focused time
  visits: number       // times the page entered view
  firstSeenAt: string  // ISO
  lastSeenAt: string   // ISO
}
export interface ReadingState {
  contentSha256: string
  pages: Record<string, PageExposure> // key = String(pageIndex)
  finished: boolean
  finishedAt: string | null // ISO
  updatedAt: string // ISO
}
```

File payload = the above + `schemaVersion: 1`. Merge logic is an exported **pure** function
`applyEvents(file, events, now)` (TDD it): dwell accumulates, visits increment, first/last
timestamps advance monotonically.

## 2. Wire contract (FROZEN — both agents build against this exactly)

Channels take **documentId**; main resolves the content hash internally (renderer never
handles hashes). A document without a hash: `get` → null; `record`/`finish` → no-op null.

```ts
// shared/db-ipc.ts
export const READING_GET_CHANNEL = 'reading:get'       // { documentId } → ReadingState | null
export const READING_RECORD_CHANNEL = 'reading:record' // { documentId, events } → ReadingState | null
export const READING_FINISH_CHANNEL = 'reading:finish' // { documentId, finished } → ReadingState | null

// zod (in reading-state.ts): documentId positive int;
// events: array(1..500) of { pageIndex: int ≥0, dwellMs: int 1..600_000, at: int (epoch ms) }
```

Preload namespace (allowlist — update the e2e exact-allowlist assertion):

```ts
window.astrolabe.reading = {
  get:    (documentId: number) => Promise<ReadingState | null>,
  record: (documentId: number, events: { pageIndex: number; dwellMs: number; at: number }[]) => Promise<ReadingState | null>,
  finish: (documentId: number, finished: boolean) => Promise<ReadingState | null>,
}
```

Renderer keeps a **local mirror** of `ReadingState`/`PageExposure` in `lens/types.ts`
(convention: component tests never reach the preload).

## 3. The Reader (renderer)

`src/renderer/src/lens/reader/` — same overlay-panel pattern as CanvasView for now (Track A
re-shells later). Injectable pdf state; jsdom tests drive placeholders.

- **usePdfDocument additions** (FROZEN interface):
  ```ts
  renderPage: (pageIndex, canvas, textLayerEl: HTMLElement | null, width) => Promise<void>
  getPageText: (pageIndex) => Promise<string>          // cached after first call
  getPageSize: (pageIndex) => Promise<{ width: number; height: number }> // base viewport, cached
  ```
  `renderPage` rasterizes AND (when `textLayerEl` given) lays a pdf.js `TextLayer` over it
  (absolute-positioned, selectable). Keep `renderThumb` untouched (Canvas uses it).
- **ReaderView**: vertical stack, one cell per page, IntersectionObserver-virtualized
  (Canvas precedent; ±~3 pages rendered, others sized placeholders — default aspect until
  `getPageSize` resolves). Zoom: reuse `pdf/zoom.ts` `nextZoom` (fit-width default here) +
  the same +/−/w/p keys. Header: title, page x/y indicator, zoom controls, **Finished**
  toggle (aria-pressed), find toggle, close.
- **In-document search**: find bar (⌘F/ctrl-F while reader open, Escape closes bar first);
  pure matcher `searchPages(texts: (string|null)[], q) → { pageIndex, count }[]` over
  `getPageText` results (fetch lazily, cache); Enter/arrows step hits; stepping scrolls to
  the page. Match highlighting inside the text layer is R3 polish — R2 ships page-level
  hits + count.
- **Dwell tracking**: pure `createDwellTracker(now)` (TDD) with `enter/leave/focus/blur/
  flush` — accumulates only while ≥50%-visible AND window focused; flush returns batched
  events (per-page dwellMs + at) and is called every ~5s and on close/unmount. Cap a single
  page's un-flushed dwell at 10 min (guards an open-overnight window).
- **Exposure ties into R1 heat**: CanvasView gains a third heat layer `read` (dwellMs
  through the existing `normalizeHeat`) — done by the integrator, not the agents.

## 4. Ownership (disjoint file sets — agents run in parallel, targeted tests only)

- **Agent A (main+seam)**: `src/main/lib/reading-state.ts` (+ unit tests for `applyEvents`,
  itest for the store round-trip on a tmp workspace), `shared/db-ipc.ts` channels,
  `src/main/index.ts` handlers, `src/preload/index.ts`, e2e allowlist expectation.
- **Agent B (renderer)**: `usePdfDocument.ts` additions, `lens/reader/*` (ReaderView,
  dwell.ts, search.ts + tests), `lens/types.ts` mirror additions.
- **Integrator (main loop)**: Lens wiring (Read action on pdf hits/hub/canvas → ReaderView,
  reading queries + record plumbing), CanvasView `read` layer, full gates, commit.

## 5. Tests (ADR-0006 altitude)

- unit/pure: `applyEvents` merge; `createDwellTracker` (focus/blur/enter/leave/cap/flush);
  `searchPages`.
- components: ReaderView chrome (toolbar, finished toggle, find bar flow, virtualized
  placeholders, keys — via injectable pdf state).
- integration: reading-state store (write→read round-trip, corrupt file → absent, no-hash
  document → null, merge across records).
- e2e: launch smoke's exact preload allowlist gains `reading`.

## 6. Out of scope

Text-layer match highlighting, TOC/outline, saved page-range Views, spreads, minimap (R3);
any comprehension/retention claims (Track L).
