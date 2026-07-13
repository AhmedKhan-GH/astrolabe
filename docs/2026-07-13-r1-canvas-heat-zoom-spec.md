# R1 — Canvas heat & zoom fixes

**Date:** 2026-07-13 · **Track:** R (Reader), phase R1 · **Parent:** `docs/2026-07-13-remaining-work-spec.md` §Track R

Fixes the concrete Canvas complaints: heat saturates at 3 fixed tiers and ignores annotation
substance; the grid has one fixed cell size; the lightbox renders at a fixed 720px with no zoom.

## 1. Wire contract (frozen)

`PageAnnotations` (defined in `src/main/index/queries.ts`, imported by preload, mirrored in
`src/renderer/src/lens/types.ts`) gains three **additive** per-page aggregates:

```ts
export interface PageAnnotations {
  pages: {
    pageIndex: number
    count: number
    /** Annotations on this page carrying a non-empty (trimmed) comment. */
    commented: number
    /** Summed length of highlighted text across the page's annotations. */
    textChars: number
    /** Summed length of comments across the page's annotations. */
    commentChars: number
  }[]
}
```

- Channel (`index:page-annotations`), request schema, preload signature: unchanged.
- SQL: extend the existing group-by with `sum(length(coalesce(text,'')))`,
  `sum(length(coalesce(comment,'')))`, and `sum(comment non-blank)`.
- Consumers: `documentDetail` embeds the same rows (additive → Hub's count sort unaffected);
  the MCP `pageAnnotations` handler delegates to the same query (enriched for free).

## 2. Heat model (pure functions in `pdf/heat.ts`)

Replaces `countToTier`/`countsToTiers` (deleted — only CanvasView consumes them).

- **Two layers**, user-toggleable: **breadth** = `count`; **depth** = annotation substance:
  `depth = textChars + COMMENT_CHAR_WEIGHT·commentChars + COMMENT_BONUS·commented`.
  Rationale (pedagogy spec, levels-of-processing): writing a comment is generative processing —
  a commented page must outweigh an equally-highlighted page without comments; comment characters
  outweigh highlight characters. Tests assert those *orderings*, not the constants.
- **Relative, continuous normalization** `normalizeHeat(values) → Map<pageIndex, intensity 0..1>`:
  reference = 95th percentile (nearest-rank) of the *nonzero* page values — a single outlier page
  no longer flattens the rest; values ≥ reference clamp to 1. Intensity = `sqrt(value/reference)`
  clamped to [0,1] (perceptual lift so lightly-annotated pages stay visible). Zero-value pages are
  absent from the map.
- Render: continuous amber alpha `MIN_ALPHA + (MAX_ALPHA − MIN_ALPHA)·intensity` (inline rgba in
  CanvasView, replacing the 3 stepped Tailwind tints). Count badge stays in both modes.

## 3. Zoom

- **Grid cell size**: `CELL_WIDTH` const → state over the ladder `[100, 140, 200, 280]` (default
  140). −/+ header controls; thumbnails re-rasterize on change (width is already a `renderThumb`
  param and an effect dep).
- **Lightbox**: fixed 720px → `nextZoom` pure reducer with state `{ mode: 'fit-width' | 'fit-page'
  | 'manual', scale }`. Fit-width = container width; fit-page = scale so the page height fits
  (aspect read from the rendered canvas bitmap, container measured via ResizeObserver — guarded
  for jsdom, fallback 720); zoom in/out = ×1.25 steps from the current *effective* scale, clamped
  [0.25, 4]. Displayed width is set explicitly (`style.width`), height auto; the container already
  scrolls on overflow. Keys while lightbox open: `+`/`=`, `-`, `w` (fit-width), `p` (fit-page).

## 4. Tests (TDD, per ADR-0006 altitude)

- **unit / pure**: depth ordering properties; `normalizeHeat` (empty, single page, outlier
  percentile clamp, sqrt monotonicity, zero-pages absent); `nextZoom` transitions + clamps.
- **unit / component** (jsdom, placeholder cells): heat mode toggles (off/breadth/depth aria
  state), continuous alpha applied per intensity, grid −/+ changes the grid template width,
  lightbox zoom controls present + mode aria state.
- **integration**: extend the existing `pageAnnotations` itest block — aggregates sum text/comment
  lengths and commented counts across instances; null-text/comment rows count as 0 chars.

## 5. Out of scope (later R phases)

Continuous-scroll reader, text layer, reading-state/exposure heat (R2); TOC, saved page-range
Views, spreads, minimap (R3). Heat layers built here must be reusable there (pure fns, no
CanvasView coupling).
