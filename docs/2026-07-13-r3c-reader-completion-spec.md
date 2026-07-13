# R3c — Reader completion: display modes, find highlighting, Views everywhere

**Date:** 2026-07-13 · **Track:** R (Reader), final phase · **Parent:** `docs/2026-07-13-r3-structure-views-spec.md` §7
Closes Track R. After this: the standing fork (Track A vs O→B).

## Scope

1. **Two-page spread** (Reader): layout toggle `single | spread`. Spread shows the cover alone,
   then facing pairs (1-2, 3-4 … of pageIndexes ≥1); each page renders at half the display
   width; text layer, dimming, dwell, and find keep working per page.
2. **Thumbnail strip** (Reader): toggleable left rail (~96px) of lazy page thumbnails
   (`renderThumb` exists on the hook), current page ringed, click → scroll. Virtualized with the
   established IntersectionObserver-guard pattern.
3. **Focus mode** (Reader): chrome-free reading — header, TOC, strip, and minimap hidden; a
   floating exit affordance; key `f` toggles (input-guarded); **Escape order: find bar → focus →
   close**.
4. **Find-match highlighting** (Reader): matches highlighted inside the pdf.js text layer via
   the **CSS Custom Highlight API** (`CSS.highlights`, supported by Electron 43's Chromium; no
   DOM mutation of pdf.js spans). Two registries: all matches (amber) + the active match
   (stronger); stepping scrolls to the active match. jsdom lacks `CSS.highlights` → guarded
   no-op; the pure OFFSET MAPPING is what unit tests pin.
5. **Views in the Canvas**: the View applied in the Reader dims non-member Canvas cells too.
   Apply-state lifts from ReaderHost to Lens (per-documentId, session-scoped); CanvasView gains
   a compact Views affordance (apply/clear; header pill shows the active View).
6. Dropped, with rationale: a Canvas heat *minimap* — the 32px whole-book grid (commit 1ff80c1)
   IS the overview; a second overview strip would duplicate it.

## Frozen contracts

**ReaderView internal state (wave 1, Agent 1)** — no new host props: `layout: 'single'|'spread'`,
`focus: boolean`, `thumbs: boolean`. Header buttons (aria-labels): `two-page spread`
(aria-pressed), `thumbnail strip` (aria-pressed), `focus mode`. Exit-focus button aria-label:
`exit focus mode`. Keys: `f` focus toggle (skip when target is an input).

**Lens/Canvas (wave 1, Agent 2)**:
```ts
// Lens owns: const [appliedViews, setAppliedViews] = useState<ReadonlyMap<number, string>>
// (documentId → applied slug; absent = none). Passed to ReaderHost AND CanvasHost.
// ReaderHost's local appliedView state is REPLACED by these props:
//   appliedView={appliedViews.get(hit.documentId) ?? null}
//   onApplyView={(slug) => setAppliedViews(prev => …set/delete…)}
// CanvasView gains (all optional, following onOpenReader precedent):
views?: DocPageView[]
appliedView?: string | null
onApplyView?: (slug: string | null) => void
// CanvasView behavior: non-member PageCells render at opacity-35 (same idiom as the Reader);
// header shows a compact menu (aria-label "views") listing saved views (apply/clear);
// while applied, an amber pill with the view name + an aria-label "clear view" ×.
```

**Find highlighting (wave 2, Agent 3)**:
```ts
// reader/highlight.ts (pure, TDD):
export interface SpanSlice { spanIndex: number; start: number; end: number }
mapMatchesToSpans(spanTexts: string[], query: string): SpanSlice[][]
  // case-insensitive; one SpanSlice[] per match, slices ordered; matches may CROSS span
  // boundaries; empty query / no matches → [].
// reader/highlight.ts (DOM, jsdom-guarded):
applyHighlights(textLayerEl, slicesPerMatch, activeIndex): void  // CSS.highlights registries
clearHighlights(): void
// textLayer.css gains ::highlight(astro-find) and ::highlight(astro-find-active) rules.
// ReaderView wires: on query/pageTexts/currentMatch change, rendered pages re-apply; active
// match's page scrolls into view (existing stepMatch already scrolls to the page).
```

## Ownership

- **Wave 1 — Agent 1 (Opus)**: `reader/ReaderView.tsx` (+test), new `reader/ThumbStrip.tsx`
  (+test). Display modes only; do NOT touch the find bar logic beyond hiding it in focus mode.
- **Wave 1 — Agent 2 (Opus)**: `lens/Lens.tsx`, `lens/CanvasView.tsx` (+test). Views lift +
  Canvas dimming/menu.
- **Wave 2 — Agent 3 (Opus, after wave 1 merges)**: `reader/highlight.ts` (+test),
  `reader/search.ts` (if offsets needed), `reader/textLayer.css`, `reader/ReaderView.tsx`
  (find wiring), `pdf/usePdfDocument.ts` only if span text extraction needs a hook change.
- **Integrator**: wave sequencing, gates, commits, roadmap update (Track R → complete), install.

## Tests

Agent 1 — components: spread pairing (cover alone; pairs after), half-width in spread, strip
thumbs + current ring + click-jump, focus hides chrome + Escape order + `f` key.
Agent 2 — components: Canvas dim on non-members, menu apply/clear, pill; Lens-level: reader
apply → canvas sees it (via shared state; component-testable through prop plumbing).
Agent 3 — unit: `mapMatchesToSpans` (within-span, cross-span, multiple, case-insensitive,
empties); components: highlight wiring no-ops cleanly in jsdom.
