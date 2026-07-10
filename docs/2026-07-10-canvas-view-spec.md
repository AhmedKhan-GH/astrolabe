# Canvas View (Track A, step 6) — Design Spec

**Date:** 2026-07-10 · **Status:** approved
**Problem:** no way to see a book at a glance. The Canvas view shows every page of a PDF as a
continuous thumbnail grid with an annotation heat layer — understanding ingestion progress
beyond progress bars and page counts. Read-only: annotation authoring stays in Zotero (D6);
pages deep-link out. "Read/finished" heat layers are future (need a reading-state store);
the annotation layer ships now because the index already holds page-anchored annotations.

## Serving PDF bytes (main)

Custom protocol, allowlisted by the index — never arbitrary paths:

- `protocol.handle('astro-doc', …)` for `astro-doc://instance/<instanceId>`: parse id →
  `document_instances.filePath` lookup → stream the file (net.fetch pathToFileURL). Unknown id,
  null filePath, or missing file → 404. Registered `privileges: { stream: true }` before
  app.whenReady.
- Renderer session CSP must not need loosening: pdf.js fetches via this scheme directly.

## Page-annotation heat data (main)

`index:page-annotations` channel: `{ documentId }` →
`{ pages: { pageIndex: number; count: number }[] }` —
`json_extract(position_json, '$.position.pageIndex')` over all annotations of the document's
instances, grouped; rows with null pageIndex dropped. Zod at the boundary as usual.

## Renderer

New dependency `pdfjs-dist` (legacy build; worker via `new URL(..., import.meta.url)` — the
proven Vite wiring recorded in docs/01 salvage manifest).

- `CanvasView.tsx` (overlay panel): full-height fixed overlay; header = title, page count,
  heat-layer toggle ("Annotations"), close × / Escape. Body = continuous CSS-grid of page
  thumbnails (fixed cell width ~140px, natural aspect), scrollable.
- `usePdfDocument(url)` hook: loads via pdfjs `getDocument`, exposes numPages + renderPage.
- Lazy render: IntersectionObserver per cell; render page → low-res canvas (~140px width ×
  devicePixelRatio) once when it approaches the viewport, destroyed when far off-screen (keep a
  bounded cache, e.g. 200 canvases). Placeholder = pageLabel on muted background.
- Heat layer: per-page annotation count → overlay tint (opacity stepped by count: 1, 2–3, 4+)
  + a small count badge; toggle hides both. Colors via existing Tailwind accent tones.
- Entry: DocumentRiver row title-click opens Canvas when the hit has kind 'pdf' and an instance
  with a filePath (prefer the zotero instance, else first with a file). Non-PDF/no-file rows
  keep current behaviour (no canvas affordance).
- Page click: deep-link out — if any of the document's annotations carry
  `positionJson.openPdfUri`, rewrite its page parameter to the clicked page (zotero
  open-pdf URI pattern already stored); else fall back to the instance's plain `uri` open.
  Wire the existing `system.open` IPC.
- State in Lens.tsx: `canvasFor: BrowseHit | null`. Query `['pageAnnotations', documentId]`
  fetched when the panel opens.

## Testing

- **Integration:** page-annotations aggregation (fixture annotations with pageIndex positions,
  null-position dropped, cross-instance grouping); protocol handler validation logic extracted
  pure (`resolveInstanceFile(db, id)`) and tested: unknown id / null path → null.
- **Unit:** heat-step mapping (count → tier), open-pdf URI page rewrite.
- **Component:** CanvasView header/close/Escape, placeholder cells render with pageLabels,
  heat badges from data, toggle hides layer, page click fires open with rewritten URI.
  pdf.js itself is NOT rendered in jsdom — `usePdfDocument` is injected/mocked; canvas
  rasterization is covered by using the app, not jsdom (change-detector otherwise).
- **E2E:** unchanged (no new preload keys — protocol + one index channel).
