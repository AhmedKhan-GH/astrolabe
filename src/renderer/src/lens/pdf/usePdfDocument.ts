import { useCallback, useEffect, useRef, useState } from 'react'
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist/legacy/build/pdf.mjs'

/**
 * The injectable prop-shape CanvasView consumes: components take this RESULT, never the
 * hook, so tests drive the whole view with a plain object and pdf.js is never exercised
 * in jsdom (spec §Testing).
 */
export interface PdfDocumentState {
  status: 'loading' | 'ready' | 'error'
  numPages: number
  /** Author-supplied page labels (front matter "ii", "xiv", …), else null. */
  pageLabels: string[] | null
  error: string | null
  /** Rasterize page `pageIndex` (0-based) into `canvas` at CSS width `width` (× dpr). */
  renderThumb: (pageIndex: number, canvas: HTMLCanvasElement, width: number) => Promise<void>
}

/**
 * Load a PDF via pdf.js (legacy build — the proven Vite wiring, docs/01 salvage manifest).
 * The module is imported dynamically so the ~1 MB library code-splits out of the main
 * chunk and never loads in test environments. The worker URL follows the
 * `new URL(..., import.meta.url)` pattern Vite turns into an emitted asset.
 */
export function usePdfDocument(url: string): PdfDocumentState {
  const [status, setStatus] = useState<PdfDocumentState['status']>('loading')
  const [numPages, setNumPages] = useState(0)
  const [pageLabels, setPageLabels] = useState<string[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const docRef = useRef<PDFDocumentProxy | null>(null)

  useEffect(() => {
    let cancelled = false
    // The loading task owns cleanup: destroying it tears down the document AND its worker.
    let task: ReturnType<typeof import('pdfjs-dist/legacy/build/pdf.mjs').getDocument> | null = null
    setStatus('loading')
    setNumPages(0)
    setPageLabels(null)
    setError(null)

    void (async () => {
      try {
        const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          'pdfjs-dist/legacy/build/pdf.worker.min.mjs',
          import.meta.url,
        ).toString()
        if (cancelled) return
        // pdf.js v6 asset packs, copied beside the bundle by vite-plugin-static-copy
        // (electron.vite.config.ts) and resolved against the document origin so the
        // same relative layout works on the dev server and the packaged astro://app
        // host. Omitting them makes pdf.js SILENTLY drop content: cmaps → CID/CJK
        // text, standardFontData → non-embedded base fonts, wasm → JBIG2/JPEG2000
        // images (scanned books), iccs → color profiles.
        const assets = new URL('pdfjs/', document.baseURI).toString()
        task = pdfjs.getDocument({
          url,
          cMapUrl: `${assets}cmaps/`,
          cMapPacked: true,
          standardFontDataUrl: `${assets}standard_fonts/`,
          wasmUrl: `${assets}wasm/`,
          iccUrl: `${assets}iccs/`,
        })
        const doc = await task.promise
        if (cancelled) return
        docRef.current = doc
        setNumPages(doc.numPages)
        setPageLabels(await doc.getPageLabels())
        setStatus('ready')
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e))
          setStatus('error')
        }
      }
    })()

    return () => {
      cancelled = true
      docRef.current = null
      void task?.destroy()
    }
  }, [url])

  // One in-flight RenderTask per canvas: pdf.js throws ("cannot use the same canvas
  // during multiple render() operations") if a second render starts before the first
  // settles — exactly what rapid lightbox paging or an eviction re-render does — and
  // the losing canvas is left blank. Cancelling the previous task first makes the
  // latest request always win; cancellations themselves are expected, not errors.
  const inFlight = useRef(new WeakMap<HTMLCanvasElement, RenderTask>())

  const renderThumb = useCallback(
    async (pageIndex: number, canvas: HTMLCanvasElement, width: number): Promise<void> => {
      const doc = docRef.current
      if (!doc) return
      const page = await doc.getPage(pageIndex + 1) // pdf.js pages are 1-based
      const dpr = window.devicePixelRatio || 1
      const base = page.getViewport({ scale: 1 })
      const viewport = page.getViewport({ scale: (width / base.width) * dpr })
      inFlight.current.get(canvas)?.cancel()
      // Only the bitmap dimensions are set — they carry the page's true aspect ratio,
      // and the caller's CSS (w-full h-auto / max-w-full max-h-full) scales the
      // intrinsic size proportionally. Inline CSS pixel sizes here would pin one axis
      // and let the other be clamped independently, distorting non-standard pages.
      canvas.width = Math.floor(viewport.width)
      canvas.height = Math.floor(viewport.height)
      const task = page.render({ canvas, viewport })
      inFlight.current.set(canvas, task)
      try {
        await task.promise
      } catch (e) {
        // Superseded renders cancel here by design; anything else is worth a trace
        // (callers fire-and-forget, so a rethrow would only become unhandled noise).
        if ((e as Error | null)?.name !== 'RenderingCancelledException') {
          console.warn('pdf thumb render failed', e)
        }
      } finally {
        if (inFlight.current.get(canvas) === task) inFlight.current.delete(canvas)
      }
    },
    [],
  )

  return { status, numPages, pageLabels, error, renderThumb }
}
