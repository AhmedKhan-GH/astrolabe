# Chat Transcript (Markdown)

## User
```tsx
import { useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import './DocumentViewer.css';

// Set up worker using local legacy worker file
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/legacy/build/pdf.worker.mjs',
  import.meta.url
).toString();

interface OutlineNode {
  title: string;
  dest: any;
  items: OutlineNode[];
}

interface PDFViewerProps {
  pdfUrl?: string;
}

export default function DocumentViewer({ pdfUrl }: PDFViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [scale, setScale] = useState(1.5);
  const [outline, setOutline] = useState<OutlineNode[]>([]);
  const [showToc, setShowToc] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());

  // Load PDF document
  useEffect(() => {
    if (!pdfUrl) return;

    setLoading(true);
    setError(null);

    const loadPdf = async () => {
      try {
        // Load PDF from blob URL
        const loadingTask = pdfjsLib.getDocument(pdfUrl);
        const pdf = await loadingTask.promise;
        setPdfDoc(pdf);
        setTotalPages(pdf.numPages);
        setCurrentPage(1);

        // Load outline (TOC)
        const pdfOutline = await pdf.getOutline();
        if (pdfOutline) {
          setOutline(pdfOutline);
        }
      } catch (err) {
        setError(`Error loading PDF: ${err instanceof Error ? err.message : 'Unknown error'}`);
        console.error('Error loading PDF:', err);
      } finally {
        setLoading(false);
      }
    };

    loadPdf();
  }, [pdfUrl]);

  // Render current page
  useEffect(() => {
    if (!pdfDoc || !canvasRef.current) return;

    const renderPage = async () => {
      try {
        const page: PDFPageProxy = await pdfDoc.getPage(currentPage);
        const viewport = page.getViewport({ scale });

        const canvas = canvasRef.current;
        if (!canvas) return;

        const context = canvas.getContext('2d');
        if (!context) return;

        // Set canvas dimensions to match viewport (maintains aspect ratio)
        canvas.height = viewport.height;
        canvas.width = viewport.width;

        // Use device pixel ratio for crisp rendering
        const outputScale = window.devicePixelRatio || 1;

        canvas.width = Math.floor(viewport.width * outputScale);
        canvas.height = Math.floor(viewport.height * outputScale);
        canvas.style.width = Math.floor(viewport.width) + 'px';
        canvas.style.height = Math.floor(viewport.height) + 'px';

        const transform = outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : null;

        const renderContext = {
          canvasContext: context,
          viewport: viewport,
          transform: transform as any,
        };

        await page.render(renderContext).promise;
      } catch (err) {
        console.error('Error rendering page:', err);
        setError(`Error rendering page: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
    };

    renderPage();
  }, [pdfDoc, currentPage, scale]);

  // Navigate to destination from TOC
  const navigateToDestination = async (dest: any) => {
    if (!pdfDoc) return;

    try {
      let destination = dest;
      if (typeof dest === 'string') {
        destination = await pdfDoc.getDestination(dest);
      }

      if (destination && Array.isArray(destination)) {
        const pageRef = destination[0];
        const pageIndex = await pdfDoc.getPageIndex(pageRef);
        setCurrentPage(pageIndex + 1);
      }
    } catch (err) {
      console.error('Error navigating to destination:', err);
    }
  };

  // Toggle node expansion
  const toggleNode = (nodePath: string) => {
    setExpandedNodes(prev => {
      const newSet = new Set(prev);
      if (newSet.has(nodePath)) {
        newSet.delete(nodePath);
      } else {
        newSet.add(nodePath);
      }
      return newSet;
    });
  };

  // Render outline tree
  const renderOutlineItems = (items: OutlineNode[], level = 0, parentPath = '') => {
    return (
      <ul className={level === 0 ? 'toc-list' : 'toc-list-nested'} style={{ marginLeft: level * 15 }}>
        {items.map((item, index) => {
          const nodePath = `${parentPath}/${index}`;
          const hasChildren = item.items && item.items.length > 0;
          const isExpanded = expandedNodes.has(nodePath);

          return (
            <li key={index} className="toc-item">
              <div className="toc-item-content">
                {hasChildren && (
                  <button
                    onClick={() => toggleNode(nodePath)}
                    className="toc-expand-btn"
                    aria-label={isExpanded ? 'Collapse' : 'Expand'}
                  >
                    {isExpanded ? '▼' : '▶'}
                  </button>
                )}
                {!hasChildren && (
                  <span className="toc-spacer"></span>
                )}
                <button
                  onClick={() => navigateToDestination(item.dest)}
                  className="toc-link-btn"
                >
                  {item.title}
                </button>
              </div>
              {hasChildren && isExpanded && renderOutlineItems(item.items, level + 1, nodePath)}
            </li>
          );
        })}
      </ul>
    );
  };

  const handlePrevPage = () => {
    if (currentPage > 1) {
      setCurrentPage(currentPage - 1);
    }
  };

  const handleNextPage = () => {
    if (currentPage < totalPages) {
      setCurrentPage(currentPage + 1);
    }
  };

  const handleZoomIn = () => {
    setScale((prev) => Math.min(prev + 0.25, 3));
  };

  const handleZoomOut = () => {
    setScale((prev) => Math.max(prev - 0.25, 0.5));
  };

  return (
    <div className="pdf-viewer-container">
      {/* Table of Contents Sidebar */}
      {showToc && outline.length > 0 && (
        <div className="toc-sidebar">
          <div className="toc-header">
            <h3>Table of Contents</h3>
            <button onClick={() => setShowToc(false)} className="toc-close-btn">✕</button>
          </div>
          {renderOutlineItems(outline)}
        </div>
      )}

      {/* Main PDF Viewer */}
      <div className="pdf-main-container">
        {/* Toolbar */}
        <div className="pdf-toolbar">
          <div className="pdf-toolbar-left">
            {!showToc && outline.length > 0 && (
              <button onClick={() => setShowToc(true)} className="pdf-toolbar-toc-btn">☰ TOC</button>
            )}
            <button onClick={handlePrevPage} disabled={currentPage <= 1}>
              Previous
            </button>
            <span>
              Page {currentPage} of {totalPages}
            </span>
            <button onClick={handleNextPage} disabled={currentPage >= totalPages}>
              Next
            </button>
          </div>

          <div className="pdf-toolbar-right">
            <button onClick={handleZoomOut} disabled={scale <= 0.5}>
              −
            </button>
            <span>{Math.round(scale * 100)}%</span>
            <button onClick={handleZoomIn} disabled={scale >= 3}>
              +
            </button>
          </div>
        </div>

        {/* PDF Canvas */}
        <div className="pdf-canvas-container">
          {loading && <div className="pdf-loading">Loading PDF...</div>}
          {error && <div className="pdf-error">{error}</div>}
          {!loading && !error && pdfDoc && (
            <canvas ref={canvasRef} className="pdf-canvas" />
          )}
          {!loading && !error && !pdfDoc && !pdfUrl && (
            <div className="pdf-no-file">
              No PDF loaded. Please upload a PDF file.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

write a professional outline of how to implement this from scratch, first principles from the ground up.
```

---

## Assistant
## 1) Define the problem in first principles

### What you are building
- A client-side PDF renderer that:
  - Loads a PDF document from a URL (including blob/object URLs).
  - Renders one page at a time into a `<canvas>`.
  - Supports page navigation (prev/next, direct jump).
  - Supports zoom (scale changes).
  - Optionally displays the document outline (table of contents) and lets users click entries to navigate.

### The irreducible components
- **A PDF parser + renderer**: pdf.js (`pdfjs-dist`) provides:
  - `getDocument()` to load a PDF into a `PDFDocumentProxy`.
  - `pdf.getPage(n)` to access a `PDFPageProxy`.
  - `page.getViewport({ scale })` to compute pixel geometry at a zoom level.
  - `page.render({ canvasContext, viewport, transform })` to paint the page onto a canvas.
  - `pdf.getOutline()`, `pdf.getDestination(name)`, `pdf.getPageIndex(ref)` to support outlines and navigation.
- **A presentation surface**: a canvas that can be resized to the viewport.
- **A state model**: current page, total pages, zoom scale, loading/error status, outline tree and expansion state.
- **A lifecycle**: load document → derive metadata (page count, outline) → render page → react to state changes.

---

## 2) Project bootstrap and environment decisions

### Choose a stack
- React + TypeScript for UI state and component structure.
- A bundler that supports `import.meta.url` (Vite is a common choice) or an equivalent asset resolution approach.

### Key constraints to plan for
- pdf.js uses a **Web Worker** for parsing to keep the UI responsive.
- Worker scripts must be resolvable by your bundler and served correctly in production.
- PDF URLs may hit **CORS** restrictions if fetched from other origins.

---

## 3) Install and wire pdf.js correctly

### Dependencies
- Install `pdfjs-dist`.
- Use the “legacy” build only if your bundler/runtime needs it; otherwise you can use the modern build, but the worker wiring must match the build you import.

### Worker configuration (non-negotiable)
- pdf.js must know where the worker script is:
  - Set `pdfjsLib.GlobalWorkerOptions.workerSrc` to a URL the browser can fetch.
  - In bundler environments, derive that URL via `new URL(..., import.meta.url).toString()` (or an equivalent bundler-specific pattern).
- Validate early by loading a known PDF and confirming no “worker failed” fallback to main thread.

---

## 4) Component architecture from the ground up

### Logical modules (even if kept in one file initially)
- **PDF loader**: owns `getDocument()` and document-level metadata retrieval.
- **Page renderer**: owns the “given doc + page + scale → draw on canvas” pipeline.
- **Navigation controller**: owns page bounds checks and state transitions.
- **Outline/TOC controller**: owns outline retrieval, tree rendering, and destination navigation.
- **UI shell**: layout (sidebar + toolbar + canvas area), loading/error overlays.

### State you need (minimum viable)
- `pdfDoc: PDFDocumentProxy | null`
- `currentPage: number`
- `totalPages: number`
- `scale: number`
- `outline: OutlineNode[]`
- `showToc: boolean`
- `expandedNodes: Set<string>` (or a map keyed by stable IDs)
- `loading: boolean`
- `error: string | null`

---

## 5) Document loading lifecycle

### Inputs and invariants
- Input: `pdfUrl?: string`
- Invariants:
  - If `pdfUrl` is absent, show an empty state.
  - If a new `pdfUrl` arrives, you must reset document-specific state and cancel/ignore stale work.

### Load sequence
1. Set `loading = true`, clear `error`.
2. Call `pdfjsLib.getDocument(pdfUrl)` to create a loading task.
3. Await `loadingTask.promise` to get `PDFDocumentProxy`.
4. Set:
   - `pdfDoc = pdf`
   - `totalPages = pdf.numPages`
   - `currentPage = 1` (or preserve prior page if you want continuity)
5. Fetch outline via `pdf.getOutline()` and store it if present.
6. Set `loading = false`.

### Robustness requirements
- Handle errors from:
  - Network failures, invalid PDFs, CORS blocks.
  - Worker misconfiguration.
- Avoid state updates after unmount:
  - Track a “still active” flag inside the effect or keep a monotonically increasing request id and ignore stale results.

---

## 6) Page rendering pipeline (canvas fundamentals)

### The core idea
Rendering a PDF page is transforming vector/text instructions into pixels. pdf.js does this when you call `page.render()` with a viewport and a canvas context.

### Rendering steps
1. Get the page:
   - `const page = await pdfDoc.getPage(currentPage)`
2. Compute geometry at the logical zoom:
   - `const viewport = page.getViewport({ scale })`
3. Prepare canvas sizing correctly:
   - Set CSS size to match `viewport.width/height` for layout.
   - Set backing store size to match `viewport * devicePixelRatio` for crispness.
4. Compute transform:
   - If `outputScale !== 1`, provide a transform `[outputScale, 0, 0, outputScale, 0, 0]`.
5. Render:
   - `await page.render({ canvasContext, viewport, transform }).promise`

### Why the devicePixelRatio step matters
- Without it, high-DPI screens show blurry text because the canvas backing buffer has fewer pixels than the CSS box.

### Cleanup and correctness
- If you render repeatedly (page changes, zoom changes), ensure you:
  - Don’t run two renders concurrently on the same canvas.
  - Optionally keep the last `renderTask` and call `renderTask.cancel()` before starting a new render to prevent wasted work and flicker.

---

## 7) Navigation and bounds logic

### Prev/Next
- Prev: only decrement if `currentPage > 1`.
- Next: only increment if `currentPage < totalPages`.

### Direct navigation
- A “jump to page” feature is just:
  - Clamp input to `[1, totalPages]`.
  - Set `currentPage` to the target.

### UX invariants
- Disable navigation buttons at boundaries.
- Keep the “Page X of Y” label always consistent with state.

---

## 8) Zoom model and rendering implications

### Scale semantics
- `scale` is a multiplier applied to the page viewport.
- Zooming is therefore:
  - Update `scale`.
  - Trigger a rerender of the same page.

### Bounds and step
- Define:
  - `minScale` (commonly 0.5)
  - `maxScale` (commonly 3)
  - `step` (commonly 0.25)
- Clamp scale updates so UI can safely disable zoom controls at extremes.

---

## 9) Outline (TOC) extraction and navigation

### Outline data
- `pdf.getOutline()` returns a tree; each node typically contains:
  - `title`
  - `dest` (destination, sometimes a named destination string)
  - `items` (children)

### Destination resolution (first principles)
- A TOC entry points to a destination that ultimately references a page.
- Resolution path:
  1. If `dest` is a string, call `pdfDoc.getDestination(dest)` to get the destination array.
  2. The destination array’s first element is usually a page reference.
  3. Convert that to a zero-based page index with `pdfDoc.getPageIndex(pageRef)`.
  4. Set `currentPage = pageIndex + 1`.

### Tree UI mechanics
- You need a stable way to track expanded/collapsed state per node:
  - A path key like `"0/2/1"` works if the outline order is stable.
- Render rules:
  - If a node has children, show an expand/collapse control.
  - Clicking the title navigates; clicking the chevron toggles expansion.
- Use accessible controls:
  - Buttons for interactive elements.
  - `aria-label` for expand/collapse.

---

## 10) Layout and styling fundamentals

### Layout goals
- Split the viewer into:
  - A left sidebar (TOC), optionally shown/hidden.
  - A main region with toolbar on top and canvas below.

### Canvas container requirements
- Center or scroll the canvas as needed.
- Handle large pages and zoom:
  - Use overflow scrolling in the canvas container.
  - Avoid resizing parent containers in ways that cause layout thrash.

### Overlay states
- Loading indicator sits above the canvas area.
- Error message is shown when rendering/loading fails.
- Empty state when no PDF is provided.

---

## 11) Performance and stability considerations

### Avoid unnecessary work
- Only rerender when `pdfDoc`, `currentPage`, or `scale` changes.
- Cache derived values if they become expensive (outline parsing, repeated destination resolutions).

### Prevent race conditions
- Rapidly changing `currentPage` or `scale` can start overlapping renders.
- Implement one of:
  - Render cancellation via `renderTask.cancel()`.
  - A render token/version check to ignore stale renders.

### Memory management
- On document change:
  - Reset outline, page state, and expanded nodes.
  - Consider calling `pdfDoc.destroy()` when replacing a document to release resources.

---

## 12) Error handling strategy

### What can fail
- Document load:
  - Network, CORS, corrupted file, worker issues.
- Rendering:
  - Canvas context unavailable, internal pdf.js failures, canceled renders.

### What to display
- A single user-facing error string in the canvas region.
- Console logging for diagnostics, without leaking internal details into the UI.

---

## 13) Accessibility and interaction correctness

### Minimum accessibility bar
- All interactive controls are buttons with clear labels.
- Disabled states use the `disabled` attribute.
- Sidebar toggle is keyboard accessible.
- Focus order is logical: toolbar → TOC → canvas region.

---

## 14) Testing approach (what to verify)

### Functional tests
- Load a PDF and confirm:
  - Total pages correct.
  - Page 1 renders.
  - Prev/Next works and clamps at bounds.
  - Zoom changes rerender and stays crisp.
  - Outline appears when present and navigates correctly.

### Regression cases
- Switch PDFs rapidly and confirm no stale renders overwrite current.
- Outline destinations that are named strings vs direct arrays.
- Extremely large pages and high zoom levels.
- PDFs with no outline.

---

## 15) Production hardening checklist

- Worker script resolves correctly in dev and production builds.
- PDF URLs work under the deployment origin’s CORS constraints.
- Rendering cancellation/versioning prevents flicker and wasted CPU.
- Document resources are cleaned up on unmount or document replacement.
- UI remains responsive while parsing due to worker usage.

A correct implementation is the disciplined assembly of four systems—document loading, page rendering, navigation state, and outline-driven destinations—connected by React state and effects that enforce strict lifecycle boundaries.

---

## User
write an additional tutorial that builds the code from first principle snippets to the final product

---

## Assistant
## Tutorial: Build a React + TypeScript PDF viewer with pdf.js from first principles

### Target outcome
A single React component that loads a PDF from a URL (including blob/object URLs), renders one page into a `<canvas>`, supports page navigation and zoom, and shows a clickable outline sidebar when the PDF contains a document outline.

---

## 0) Files and dependencies

### Files
```
src/
  DocumentViewer.tsx
  DocumentViewer.css
  App.tsx
```

### Install
```bash
npm i pdfjs-dist
```

---

## 1) Worker wiring (the non-optional foundation)

pdf.js parses PDFs in a Web Worker. Without this, performance degrades and the viewer may fail depending on bundler settings.

At the top of `DocumentViewer.tsx`:

```ts
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/legacy/build/pdf.worker.mjs',
  import.meta.url
).toString();
```

This ties the worker file location to the bundler output so it resolves in dev and production.

---

## 2) Stage 1: Minimal render pipeline (PDF → Page → Canvas)

Create the smallest component that renders page 1 into a `<canvas>`.

`src/DocumentViewer.tsx`
```tsx
import { useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import './DocumentViewer.css';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/legacy/build/pdf.worker.mjs',
  import.meta.url
).toString();

type Props = { pdfUrl?: string };

export default function DocumentViewer({ pdfUrl }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);

  // Load the document
  useEffect(() => {
    if (!pdfUrl) {
      setPdfDoc(null);
      return;
    }

    let alive = true;

    (async () => {
      const task = pdfjsLib.getDocument(pdfUrl);
      const pdf = await task.promise;
      if (!alive) return;
      setPdfDoc(pdf);
    })().catch(console.error);

    return () => {
      alive = false;
    };
  }, [pdfUrl]);

  // Render page 1
  useEffect(() => {
    if (!pdfDoc || !canvasRef.current) return;

    let alive = true;

    (async () => {
      const page: PDFPageProxy = await pdfDoc.getPage(1);
      if (!alive) return;

      const viewport = page.getViewport({ scale: 1 });

      const canvas = canvasRef.current!;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);

      await page.render({ canvasContext: ctx, viewport }).promise;
    })().catch(console.error);

    return () => {
      alive = false;
    };
  }, [pdfDoc]);

  return (
    <div className="pdf-shell">
      <canvas ref={canvasRef} className="pdf-canvas" />
    </div>
  );
}
```

At this point, the viewer proves the core physics: pdf.js loads a document, retrieves a page, builds a viewport, and paints into a 2D canvas context.

---

## 3) Stage 2: Crisp rendering on high-DPI screens (devicePixelRatio)

Canvas has two sizes:
- CSS size (layout)
- Backing buffer size (actual pixels)

To render crisp text, scale the backing buffer by `window.devicePixelRatio`.

Replace the render portion with this:

```ts
const viewport = page.getViewport({ scale: 1 });

const canvas = canvasRef.current!;
const ctx = canvas.getContext('2d');
if (!ctx) return;

// CSS size
canvas.style.width = `${Math.floor(viewport.width)}px`;
canvas.style.height = `${Math.floor(viewport.height)}px`;

// Backing buffer size
const outputScale = window.devicePixelRatio || 1;
canvas.width = Math.floor(viewport.width * outputScale);
canvas.height = Math.floor(viewport.height * outputScale);

const transform =
  outputScale !== 1 ? ([outputScale, 0, 0, outputScale, 0, 0] as const) : null;

await page.render({ canvasContext: ctx, viewport, transform: transform as any }).promise;
```

This preserves layout while allocating enough pixels for sharp rendering.

---

## 4) Stage 3: Add page state and navigation (currentPage / totalPages)

A PDF is a sequence of numbered pages. Navigation is bounds-checked integer updates.

Add state:

```ts
const [currentPage, setCurrentPage] = useState(1);
const [totalPages, setTotalPages] = useState(0);
```

When loading the document:

```ts
setPdfDoc(pdf);
setTotalPages(pdf.numPages);
setCurrentPage(1);
```

Render effect now depends on `currentPage`:

```ts
const page: PDFPageProxy = await pdfDoc.getPage(currentPage);
```

Add handlers:

```ts
const handlePrevPage = () => setCurrentPage(p => Math.max(1, p - 1));
const handleNextPage = () => setCurrentPage(p => Math.min(totalPages, p + 1));
```

Add a basic toolbar:

```tsx
<div className="pdf-toolbar">
  <button onClick={handlePrevPage} disabled={currentPage <= 1}>Previous</button>
  <span>Page {currentPage} of {totalPages}</span>
  <button onClick={handleNextPage} disabled={currentPage >= totalPages}>Next</button>
</div>
```

---

## 5) Stage 4: Zoom is just viewport scaling (scale state)

Zoom is a scalar that changes the viewport geometry and forces rerender.

Add:

```ts
const [scale, setScale] = useState(1.5);

const handleZoomOut = () => setScale(s => Math.max(0.5, s - 0.25));
const handleZoomIn  = () => setScale(s => Math.min(3, s + 0.25));
```

Use `scale` in viewport:

```ts
const viewport = page.getViewport({ scale });
```

Add zoom controls:

```tsx
<div className="pdf-toolbar-right">
  <button onClick={handleZoomOut} disabled={scale <= 0.5}>−</button>
  <span>{Math.round(scale * 100)}%</span>
  <button onClick={handleZoomIn} disabled={scale >= 3}>+</button>
</div>
```

---

## 6) Stage 5: Add loading and error states (operational correctness)

Loading and render can fail. A professional viewer reflects that in UI state.

Add state:

```ts
const [loading, setLoading] = useState(false);
const [error, setError] = useState<string | null>(null);
```

Wrap document load:

```ts
setLoading(true);
setError(null);

try {
  const task = pdfjsLib.getDocument(pdfUrl);
  const pdf = await task.promise;
  setPdfDoc(pdf);
  setTotalPages(pdf.numPages);
  setCurrentPage(1);
} catch (e) {
  setError(`Error loading PDF: ${e instanceof Error ? e.message : 'Unknown error'}`);
  setPdfDoc(null);
  setTotalPages(0);
} finally {
  setLoading(false);
}
```

Wrap render similarly:

```ts
try {
  // render logic
} catch (e) {
  setError(`Error rendering page: ${e instanceof Error ? e.message : 'Unknown error'}`);
}
```

UI overlay:

```tsx
<div className="pdf-canvas-container">
  {loading && <div className="pdf-loading">Loading PDF...</div>}
  {error && <div className="pdf-error">{error}</div>}
  {!loading && !error && pdfDoc && <canvas ref={canvasRef} className="pdf-canvas" />}
  {!loading && !error && !pdfDoc && !pdfUrl && (
    <div className="pdf-empty">No PDF loaded.</div>
  )}
</div>
```

---

## 7) Stage 6: Outline (TOC) extraction and destination navigation

### The concept
- The outline is a tree of entries.
- Each entry points to a destination.
- A destination resolves to a page reference, which resolves to a page index.

Add types:

```ts
interface OutlineNode {
  title: string;
  dest: any;
  items: OutlineNode[];
}
```

Add state:

```ts
const [outline, setOutline] = useState<OutlineNode[]>([]);
const [showToc, setShowToc] = useState(true);
const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
```

Fetch outline during load:

```ts
const pdfOutline = await pdf.getOutline();
setOutline((pdfOutline as any) ?? []);
setExpandedNodes(new Set());
setShowToc(true);
```

Navigation function:

```ts
const navigateToDestination = async (dest: any) => {
  if (!pdfDoc) return;

  try {
    let destination = dest;
    if (typeof dest === 'string') {
      destination = await pdfDoc.getDestination(dest);
    }

    if (destination && Array.isArray(destination)) {
      const pageRef = destination[0];
      const pageIndex = await pdfDoc.getPageIndex(pageRef);
      setCurrentPage(pageIndex + 1);
    }
  } catch (e) {
    console.error('Error navigating to destination:', e);
  }
};
```

Expansion toggle:

```ts
const toggleNode = (nodePath: string) => {
  setExpandedNodes(prev => {
    const copy = new Set(prev);
    if (copy.has(nodePath)) copy.delete(nodePath);
    else copy.add(nodePath);
    return copy;
  });
};
```

Recursive tree renderer:

```tsx
const renderOutlineItems = (items: OutlineNode[], level = 0, parentPath = '') => (
  <ul className={level === 0 ? 'toc-list' : 'toc-list-nested'} style={{ marginLeft: level * 15 }}>
    {items.map((item, index) => {
      const nodePath = `${parentPath}/${index}`;
      const hasChildren = !!item.items?.length;
      const isExpanded = expandedNodes.has(nodePath);

      return (
        <li key={nodePath} className="toc-item">
          <div className="toc-item-content">
            {hasChildren ? (
              <button
                onClick={() => toggleNode(nodePath)}
                className="toc-expand-btn"
                aria-label={isExpanded ? 'Collapse' : 'Expand'}
              >
                {isExpanded ? '▼' : '▶'}
              </button>
            ) : (
              <span className="toc-spacer" />
            )}

            <button onClick={() => navigateToDestination(item.dest)} className="toc-link-btn">
              {item.title}
            </button>
          </div>

          {hasChildren && isExpanded && renderOutlineItems(item.items, level + 1, nodePath)}
        </li>
      );
    })}
  </ul>
);
```

Sidebar layout:

```tsx
{showToc && outline.length > 0 && (
  <aside className="toc-sidebar">
    <div className="toc-header">
      <h3>Table of Contents</h3>
      <button onClick={() => setShowToc(false)} className="toc-close-btn">✕</button>
    </div>
    {renderOutlineItems(outline)}
  </aside>
)}
```

Toolbar TOC toggle when hidden:

```tsx
{!showToc && outline.length > 0 && (
  <button onClick={() => setShowToc(true)} className="pdf-toolbar-toc-btn">☰ TOC</button>
)}
```

---

## 8) Stage 7: Assemble the final component (complete code)

`src/DocumentViewer.tsx`
```tsx
import { useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import './DocumentViewer.css';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/legacy/build/pdf.worker.mjs',
  import.meta.url
).toString();

interface OutlineNode {
  title: string;
  dest: any;
  items: OutlineNode[];
}

interface PDFViewerProps {
  pdfUrl?: string;
}

export default function DocumentViewer({ pdfUrl }: PDFViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [scale, setScale] = useState(1.5);

  const [outline, setOutline] = useState<OutlineNode[]>([]);
  const [showToc, setShowToc] = useState(true);
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load PDF document
  useEffect(() => {
    if (!pdfUrl) {
      setPdfDoc(null);
      setOutline([]);
      setTotalPages(0);
      setCurrentPage(1);
      setError(null);
      setLoading(false);
      return;
    }

    let alive = true;

    (async () => {
      setLoading(true);
      setError(null);

      try {
        const loadingTask = pdfjsLib.getDocument(pdfUrl);
        const pdf: PDFDocumentProxy = await loadingTask.promise;
        if (!alive) return;

        setPdfDoc(pdf);
        setTotalPages(pdf.numPages);
        setCurrentPage(1);

        const pdfOutline = await pdf.getOutline();
        if (!alive) return;

        setOutline((pdfOutline as any) ?? []);
        setExpandedNodes(new Set());
        setShowToc(true);
      } catch (e) {
        if (!alive) return;
        setError(`Error loading PDF: ${e instanceof Error ? e.message : 'Unknown error'}`);
        setPdfDoc(null);
        setOutline([]);
        setTotalPages(0);
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [pdfUrl]);

  // Render current page
  useEffect(() => {
    if (!pdfDoc || !canvasRef.current) return;

    let alive = true;
    let renderTask: any = null;

    (async () => {
      try {
        const page: PDFPageProxy = await pdfDoc.getPage(currentPage);
        if (!alive) return;

        const viewport = page.getViewport({ scale });

        const canvas = canvasRef.current!;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const outputScale = window.devicePixelRatio || 1;

        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;

        canvas.width = Math.floor(viewport.width * outputScale);
        canvas.height = Math.floor(viewport.height * outputScale);

        const transform =
          outputScale !== 1 ? ([outputScale, 0, 0, outputScale, 0, 0] as const) : null;

        renderTask = page.render({
          canvasContext: ctx,
          viewport,
          transform: transform as any,
        });

        await renderTask.promise;
      } catch (e: any) {
        if (!alive) return;
        if (e?.name === 'RenderingCancelledException') return;
        setError(`Error rendering page: ${e instanceof Error ? e.message : 'Unknown error'}`);
      }
    })();

    return () => {
      alive = false;
      try {
        renderTask?.cancel?.();
      } catch {
        // ignore
      }
    };
  }, [pdfDoc, currentPage, scale]);

  // TOC navigation
  const navigateToDestination = async (dest: any) => {
    if (!pdfDoc) return;

    try {
      let destination = dest;
      if (typeof dest === 'string') {
        destination = await pdfDoc.getDestination(dest);
      }

      if (destination && Array.isArray(destination)) {
        const pageRef = destination[0];
        const pageIndex = await pdfDoc.getPageIndex(pageRef);
        setCurrentPage(pageIndex + 1);
      }
    } catch (e) {
      console.error('Error navigating to destination:', e);
    }
  };

  // Expand/collapse nodes
  const toggleNode = (nodePath: string) => {
    setExpandedNodes(prev => {
      const copy = new Set(prev);
      if (copy.has(nodePath)) copy.delete(nodePath);
      else copy.add(nodePath);
      return copy;
    });
  };

  // Render outline tree
  const renderOutlineItems = (items: OutlineNode[], level = 0, parentPath = '') => (
    <ul className={level === 0 ? 'toc-list' : 'toc-list-nested'} style={{ marginLeft: level * 15 }}>
      {items.map((item, index) => {
        const nodePath = `${parentPath}/${index}`;
        const hasChildren = !!item.items?.length;
        const isExpanded = expandedNodes.has(nodePath);

        return (
          <li key={nodePath} className="toc-item">
            <div className="toc-item-content">
              {hasChildren ? (
                <button
                  onClick={() => toggleNode(nodePath)}
                  className="toc-expand-btn"
                  aria-label={isExpanded ? 'Collapse' : 'Expand'}
                >
                  {isExpanded ? '▼' : '▶'}
                </button>
              ) : (
                <span className="toc-spacer" />
              )}

              <button onClick={() => navigateToDestination(item.dest)} className="toc-link-btn">
                {item.title}
              </button>
            </div>

            {hasChildren && isExpanded && renderOutlineItems(item.items, level + 1, nodePath)}
          </li>
        );
      })}
    </ul>
  );

  const handlePrevPage = () => setCurrentPage(p => Math.max(1, p - 1));
  const handleNextPage = () => setCurrentPage(p => Math.min(totalPages, p + 1));
  const handleZoomIn = () => setScale(s => Math.min(3, s + 0.25));
  const handleZoomOut = () => setScale(s => Math.max(0.5, s - 0.25));

  return (
    <div className="pdf-viewer-container">
      {showToc && outline.length > 0 && (
        <aside className="toc-sidebar">
          <div className="toc-header">
            <h3>Table of Contents</h3>
            <button onClick={() => setShowToc(false)} className="toc-close-btn">✕</button>
          </div>
          {renderOutlineItems(outline)}
        </aside>
      )}

      <div className="pdf-main-container">
        <div className="pdf-toolbar">
          <div className="pdf-toolbar-left">
            {!showToc && outline.length > 0 && (
              <button onClick={() => setShowToc(true)} className="pdf-toolbar-toc-btn">☰ TOC</button>
            )}

            <button onClick={handlePrevPage} disabled={currentPage <= 1}>Previous</button>
            <span>Page {currentPage} of {totalPages}</span>
            <button onClick={handleNextPage} disabled={currentPage >= totalPages}>Next</button>
          </div>

          <div className="pdf-toolbar-right">
            <button onClick={handleZoomOut} disabled={scale <= 0.5}>−</button>
            <span>{Math.round(scale * 100)}%</span>
            <button onClick={handleZoomIn} disabled={scale >= 3}>+</button>
          </div>
        </div>

        <div className="pdf-canvas-container">
          {loading && <div className="pdf-loading">Loading PDF...</div>}
          {error && <div className="pdf-error">{error}</div>}

          {!loading && !error && pdfDoc && <canvas ref={canvasRef} className="pdf-canvas" />}

          {!loading && !error && !pdfDoc && !pdfUrl && (
            <div className="pdf-empty">No PDF loaded.</div>
          )}
        </div>
      </div>
    </div>
  );
}
```

---

## 9) CSS layout (final)

`src/DocumentViewer.css`
```css
.pdf-viewer-container {
  display: flex;
  height: 100%;
  width: 100%;
  overflow: hidden;
  font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
}

.toc-sidebar {
  width: 320px;
  border-right: 1px solid #e5e5e5;
  overflow: auto;
  background: #fff;
}

.toc-header {
  position: sticky;
  top: 0;
  background: #fff;
  border-bottom: 1px solid #e5e5e5;
  padding: 12px 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.toc-close-btn {
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 16px;
}

.toc-list,
.toc-list-nested {
  list-style: none;
  padding-left: 12px;
  margin: 8px 0;
}

.toc-item {
  margin: 4px 0;
}

.toc-item-content {
  display: flex;
  align-items: center;
  gap: 6px;
}

.toc-expand-btn {
  width: 26px;
  border: none;
  background: transparent;
  cursor: pointer;
}

.toc-spacer {
  display: inline-block;
  width: 26px;
}

.toc-link-btn {
  border: none;
  background: transparent;
  cursor: pointer;
  text-align: left;
  padding: 4px 6px;
  border-radius: 6px;
}

.toc-link-btn:hover {
  background: #f3f3f3;
}

.pdf-main-container {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: #fafafa;
}

.pdf-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 12px;
  border-bottom: 1px solid #e5e5e5;
  background: #fff;
}

.pdf-toolbar-left,
.pdf-toolbar-right {
  display: flex;
  align-items: center;
  gap: 10px;
}

.pdf-toolbar button {
  border: 1px solid #d7d7d7;
  background: #fff;
  padding: 6px 10px;
  border-radius: 8px;
  cursor: pointer;
}

.pdf-toolbar button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.pdf-toolbar-toc-btn {
  font-weight: 600;
}

.pdf-canvas-container {
  position: relative;
  flex: 1;
  overflow: auto;
  padding: 16px;
}

.pdf-canvas {
  display: block;
  margin: 0 auto;
  background: #fff;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08);
}

.pdf-loading,
.pdf-error,
.pdf-empty {
  position: absolute;
  top: 16px;
  left: 16px;
  right: 16px;
  padding: 10px 12px;
  border-radius: 10px;
  background: #fff;
  border: 1px solid #e5e5e5;
}

.pdf-error {
  border-color: #ffb4b4;
}
```

---

## 10) A minimal parent that provides a blob URL

`src/App.tsx`
```tsx
import { useEffect, useState } from 'react';
import DocumentViewer from './DocumentViewer';

export default function App() {
  const [pdfUrl, setPdfUrl] = useState<string | undefined>(undefined);

  useEffect(() => {
    return () => {
      if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    };
  }, [pdfUrl]);

  return (
    <div style={{ height: '100vh' }}>
      <div style={{ padding: 12, borderBottom: '1px solid #e5e5e5', background: '#fff' }}>
        <input
          type="file"
          accept="application/pdf"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;

            const url = URL.createObjectURL(file);
            setPdfUrl(prev => {
              if (prev) URL.revokeObjectURL(prev);
              return url;
            });
          }}
        />
      </div>

      <div style={{ height: 'calc(100vh - 53px)' }}>
        <DocumentViewer pdfUrl={pdfUrl} />
      </div>
    </div>
  );
}
```

This builds the viewer by establishing the worker, proving the render pipeline, scaling the canvas correctly, layering navigation and zoom as pure state, and adding outline-driven destination jumps to reach the final integrated component.

---

## User
give me a file with this entire chat in markdown format
