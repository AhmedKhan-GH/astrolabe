import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import type { PdfDocumentState } from './pdf/usePdfDocument'
import { depthValue, normalizeHeat } from './pdf/heat'
import { nextZoom, type ZoomAction, type ZoomState } from './pdf/zoom'
import type { DocPageView, PageAnnotations, ReadingState } from './types'

/**
 * The grid cell-size ladder (CSS px). The default (140) is a readable page thumbnail; the
 * smaller steps down to 32px are the "see the whole book at once" overview — every page
 * tiled small enough to fit the annotation/heat pattern of an entire book on one screen.
 */
const CELL_SIZES = [32, 52, 84, 140, 210, 280] as const
const DEFAULT_CELL = 3
/** At/below this cell width the grid is a bird's-eye overview: tighter gaps, no count badges. */
const COMPACT_BELOW = 90
/** Lightbox base width when the container cannot be measured (jsdom, first paint). */
const FALLBACK_BASE = 720
/** Bounded canvas cache — beyond this, the oldest off-screen thumbnails revert to placeholders. */
const MAX_RENDERED = 200

/** Continuous amber tint: intensity 0..1 → alpha, floored so light pages stay visible. */
const MIN_ALPHA = 0.08
const MAX_ALPHA = 0.45
const heatTint = (intensity: number): string =>
  `rgba(245, 158, 11, ${(MIN_ALPHA + (MAX_ALPHA - MIN_ALPHA) * intensity).toFixed(3)})`

type HeatMode = 'breadth' | 'depth' | 'read'

const clampPage = (index: number, numPages: number): number =>
  Math.min(numPages - 1, Math.max(0, index))

/**
 * Canvas view — every page of a PDF as a continuous thumbnail grid with continuous,
 * document-relative annotation heat in two layers: breadth (count) and depth (annotation
 * substance) (docs/2026-07-13-r1-canvas-heat-zoom-spec §2–3). Receives the pdf hook RESULT
 * as a prop so tests drive it without pdf.js; thumbnails render lazily via
 * IntersectionObserver (absent in jsdom → cells stay placeholders, by design).
 */
export function CanvasView({
  title,
  pdf,
  heat,
  reading,
  views = [],
  appliedView = null,
  onOpenPage,
  onOpenReader,
  onOpenDetails,
  onApplyView,
  onClose,
}: {
  title: string
  pdf: PdfDocumentState
  /** Per-page annotation aggregates; null while the query is in flight (no heat layer yet). */
  heat: PageAnnotations | null
  /** Persisted exposure (engagement, never comprehension) — enables the `read` heat layer. */
  reading?: ReadingState | null
  /** Saved page-range Views for this document (host-provided); the applied one dims non-members. */
  views?: DocPageView[]
  /** The slug of the currently-applied View, or null — non-member cells dim while set. */
  appliedView?: string | null
  onOpenPage: (pageIndex: number) => void
  /** Opens the continuous-scroll Reader for this document (panel swap); hidden when unwired. */
  onOpenReader?: () => void
  /** Cross-link to the Document Hub for this document (panel swap); hidden when unwired. */
  onOpenDetails?: () => void
  /** Apply a View by slug, or null to clear; the menu/pill hide when unwired (save/delete live in the Reader). */
  onApplyView?: (slug: string | null) => void
  onClose: () => void
}) {
  const [heatOn, setHeatOn] = useState(true)
  const [heatMode, setHeatMode] = useState<HeatMode>('breadth')
  const [cellIdx, setCellIdx] = useState(DEFAULT_CELL)
  const [viewsOpen, setViewsOpen] = useState(false)
  // The page shown in the in-canvas lightbox (0-based), or null when it is closed.
  const [lightbox, setLightbox] = useState<number | null>(null)
  // Pages whose thumbnail canvas currently exists (LRU-bounded, see markVisible).
  const [rendered, setRendered] = useState<ReadonlySet<number>>(new Set())
  const renderOrder = useRef<number[]>([]) // insertion order — the eviction queue
  const visibleNow = useRef<Set<number>>(new Set()) // never evict what's on screen
  const observerRef = useRef<IntersectionObserver | null>(null)
  const numPages = pdf.status === 'ready' ? pdf.numPages : 0
  const cellWidth = CELL_SIZES[cellIdx]!
  const compact = cellWidth < COMPACT_BELOW

  // Escape closes the lightbox FIRST (canvas stays open), then the canvas — the two never
  // fight over one keypress. While the lightbox is open, ←/→ page through it (clamped).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (lightbox !== null) {
        if (e.key === 'Escape') setLightbox(null)
        else if (e.key === 'ArrowLeft') setLightbox((i) => (i === null ? i : clampPage(i - 1, numPages)))
        else if (e.key === 'ArrowRight') setLightbox((i) => (i === null ? i : clampPage(i + 1, numPages)))
      } else if (e.key === 'Escape') {
        onClose()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, lightbox, numPages])

  // The read layer exists only when exposure has actually been recorded.
  const hasRead = !!reading && Object.keys(reading.pages).length > 0
  const mode: HeatMode = heatMode === 'read' && !hasRead ? 'breadth' : heatMode

  // Continuous intensities, relative to THIS document under the active layer: breadth =
  // annotation count, depth = substance (levels-of-processing weighting in pdf/heat.ts),
  // read = accumulated dwell (exposure — engagement, never comprehension).
  const intensities = useMemo(() => {
    const values =
      mode === 'read'
        ? Object.entries(reading?.pages ?? {}).map(([pageIndex, e]) => ({
            pageIndex: Number(pageIndex),
            value: e.dwellMs,
          }))
        : (heat?.pages ?? []).map((p) => ({
            pageIndex: p.pageIndex,
            value: mode === 'breadth' ? p.count : depthValue(p),
          }))
    return normalizeHeat(values)
  }, [heat, reading, mode])
  const counts = useMemo(() => {
    const m = new Map<number, number>()
    for (const p of heat?.pages ?? []) m.set(p.pageIndex, p.count)
    return m
  }, [heat])

  // The applied View (resolved to the loaded list) and its member pages — non-members dim.
  const appliedViewObj = useMemo(
    () => views.find((v) => v.slug === appliedView) ?? null,
    [views, appliedView],
  )
  const appliedPages = useMemo(
    () => (appliedViewObj ? new Set(appliedViewObj.pages) : null),
    [appliedViewObj],
  )

  const markVisible = useCallback((pageIndex: number) => {
    setRendered((prev) => {
      if (prev.has(pageIndex)) return prev
      const next = new Set(prev)
      next.add(pageIndex)
      renderOrder.current.push(pageIndex)
      // Evict the oldest off-screen thumbnails past the cache bound.
      while (next.size > MAX_RENDERED && renderOrder.current.length > 0) {
        const idx = renderOrder.current.findIndex((p) => !visibleNow.current.has(p))
        if (idx === -1) break
        const [evicted] = renderOrder.current.splice(idx, 1)
        next.delete(evicted!)
      }
      return next
    })
  }, [])

  // One shared observer; cells register their element on mount. Guarded because jsdom
  // has no IntersectionObserver — there, every cell stays a placeholder (tests rely on it).
  const registerCell = useCallback(
    (_pageIndex: number, el: HTMLElement | null) => {
      if (typeof IntersectionObserver === 'undefined') return
      observerRef.current ??= new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            const page = Number((entry.target as HTMLElement).dataset.pageIndex)
            if (entry.isIntersecting) {
              visibleNow.current.add(page)
              markVisible(page)
            } else {
              visibleNow.current.delete(page)
            }
          }
        },
        // Start rasterizing a bit before the cell scrolls into view.
        { rootMargin: '600px' },
      )
      if (el) observerRef.current.observe(el)
    },
    [markVisible],
  )
  useEffect(() => () => observerRef.current?.disconnect(), [])

  return (
    <div
      role="dialog"
      aria-label="canvas view"
      className="fixed inset-y-0 right-0 z-20 flex w-[min(60rem,92vw)] flex-col border-l border-zinc-800 bg-zinc-950 shadow-2xl"
    >
      <header className="flex items-center gap-3 border-b border-zinc-800 px-4 py-3">
        <h2 className="min-w-0 truncate font-medium text-zinc-100">{title}</h2>
        {pdf.status === 'ready' && (
          <span className="shrink-0 text-xs text-zinc-500">{pdf.numPages} pages</span>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <button
            aria-label="smaller pages"
            title="Smaller pages"
            disabled={cellIdx === 0}
            onClick={() => setCellIdx((i) => Math.max(0, i - 1))}
            className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800 disabled:opacity-30"
          >
            −
          </button>
          <button
            aria-label="larger pages"
            title="Larger pages"
            disabled={cellIdx === CELL_SIZES.length - 1}
            onClick={() => setCellIdx((i) => Math.min(CELL_SIZES.length - 1, i + 1))}
            className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800 disabled:opacity-30"
          >
            +
          </button>
          <button
            aria-pressed={heatOn}
            onClick={() => setHeatOn((v) => !v)}
            className={clsx(
              'rounded border px-2 py-1 text-xs',
              heatOn
                ? 'border-amber-700 bg-amber-950 text-amber-300'
                : 'border-zinc-700 text-zinc-500 hover:bg-zinc-800',
            )}
          >
            Annotations
          </button>
          {heatOn && (
            <span className="flex overflow-hidden rounded border border-zinc-700 text-xs">
              {(['breadth', 'depth', ...(hasRead ? (['read'] as const) : [])] as HeatMode[]).map(
                (m) => (
                  <button
                    key={m}
                    aria-pressed={mode === m}
                    onClick={() => setHeatMode(m)}
                    className={clsx(
                      'px-2 py-1',
                      mode === m ? 'bg-amber-950 text-amber-300' : 'text-zinc-500 hover:bg-zinc-800',
                    )}
                  >
                    {m === 'breadth' ? 'count' : m}
                  </button>
                ),
              )}
            </span>
          )}
          {views.length > 0 && onApplyView && (
            <div className="relative">
              <button
                aria-label="views"
                aria-pressed={appliedView !== null}
                title="Page-range views"
                onClick={() => setViewsOpen((v) => !v)}
                className={clsx(
                  'rounded border px-2 py-1 text-xs',
                  appliedView !== null
                    ? 'border-amber-700 bg-amber-950 text-amber-300'
                    : 'border-zinc-700 text-zinc-300 hover:bg-zinc-800',
                )}
              >
                Views
              </button>
              {viewsOpen && (
                <div className="absolute right-0 top-full z-40 mt-1 w-56 rounded border border-zinc-700 bg-zinc-900 p-2 shadow-xl">
                  <ul className="flex flex-col gap-0.5">
                    {views.map((v) => (
                      <li key={v.slug}>
                        <button
                          aria-label={`apply ${v.name}`}
                          aria-pressed={appliedView === v.slug}
                          onClick={() => onApplyView(appliedView === v.slug ? null : v.slug)}
                          className={clsx(
                            'w-full truncate rounded px-2 py-1 text-left text-xs',
                            appliedView === v.slug
                              ? 'bg-amber-950 text-amber-300'
                              : 'text-zinc-300 hover:bg-zinc-800',
                          )}
                        >
                          {v.name} <span className="text-zinc-600">· {v.pages.length}p</span>
                        </button>
                      </li>
                    ))}
                    {appliedView !== null && (
                      <li>
                        <button
                          aria-label="show all pages"
                          onClick={() => onApplyView(null)}
                          className="w-full rounded px-2 py-1 text-left text-xs text-zinc-400 hover:bg-zinc-800"
                        >
                          ▸ Show all pages
                        </button>
                      </li>
                    )}
                  </ul>
                </div>
              )}
            </div>
          )}
          {appliedViewObj && onApplyView && (
            <span className="flex items-center gap-1 rounded-full border border-amber-700 bg-amber-950 px-2 py-0.5 text-xs text-amber-300">
              <span className="max-w-[8rem] truncate">{appliedViewObj.name}</span>
              <button
                aria-label="clear view"
                title="Clear the applied view"
                onClick={() => onApplyView(null)}
                className="leading-none text-amber-400 hover:text-amber-200"
              >
                ×
              </button>
            </span>
          )}
          {onOpenReader && (
            <button
              aria-label="open reader"
              title="Read this document"
              onClick={onOpenReader}
              className="rounded border border-emerald-800 bg-emerald-950 px-2 py-1 text-xs text-emerald-300 hover:bg-emerald-900"
            >
              read
            </button>
          )}
          {onOpenDetails && (
            <button
              aria-label="document details"
              title="Document details"
              onClick={onOpenDetails}
              className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800"
            >
              ⓘ
            </button>
          )}
          <button
            aria-label="close canvas"
            onClick={onClose}
            className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800"
          >
            ×
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {pdf.status === 'loading' && <p className="text-sm text-zinc-600">loading PDF…</p>}
        {pdf.status === 'error' && (
          <p className="text-sm text-red-400">could not load PDF: {pdf.error}</p>
        )}
        {pdf.status === 'ready' && (
          <div
            data-testid="page-grid"
            className={clsx('grid', compact ? 'gap-1' : 'gap-2')}
            style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${cellWidth}px, 1fr))` }}
          >
            {Array.from({ length: pdf.numPages }, (_, pageIndex) => (
              <PageCell
                key={pageIndex}
                pageIndex={pageIndex}
                label={pdf.pageLabels?.[pageIndex] ?? String(pageIndex + 1)}
                intensity={intensities.get(pageIndex) ?? null}
                count={compact || mode === 'read' ? null : (counts.get(pageIndex) ?? 0)}
                heatOn={heatOn}
                cellWidth={cellWidth}
                compact={compact}
                dimmed={appliedPages !== null && !appliedPages.has(pageIndex)}
                rendered={rendered.has(pageIndex)}
                renderThumb={pdf.renderThumb}
                register={registerCell}
                onSelect={setLightbox}
              />
            ))}
          </div>
        )}
      </div>

      {lightbox !== null && pdf.status === 'ready' && (
        <PageLightbox
          pageIndex={lightbox}
          label={pdf.pageLabels?.[lightbox] ?? String(lightbox + 1)}
          numPages={pdf.numPages}
          renderThumb={pdf.renderThumb}
          onNavigate={(delta) => setLightbox((i) => (i === null ? i : clampPage(i + delta, pdf.numPages)))}
          onOpenPage={onOpenPage}
          onClose={() => setLightbox(null)}
        />
      )}
    </div>
  )
}

/**
 * In-canvas lightbox: a large render of one page, overlaid on the canvas (which stays open
 * behind it). ←/→ chevrons and arrow keys page through it; fit-page (default) / fit-width /
 * manual ×1.25 zoom steps re-rasterize at the displayed width so pixels stay sharp
 * (spec §3); "open in source ↗" hands off to the reader via onOpenPage.
 */
function PageLightbox({
  pageIndex,
  label,
  numPages,
  renderThumb,
  onNavigate,
  onOpenPage,
  onClose,
}: {
  pageIndex: number
  label: string
  numPages: number
  renderThumb: PdfDocumentState['renderThumb']
  onNavigate: (delta: number) => void
  onOpenPage: (pageIndex: number) => void
  onClose: () => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [zoom, setZoom] = useState<ZoomState>({ mode: 'fit-page', scale: 1 })
  // The zoom basis: the container's width, measured once on mount (refs are off-limits
  // during render); the fixed fallback covers pre-layout and jsdom.
  const [base, setBase] = useState(FALLBACK_BASE)
  useEffect(() => {
    const w = containerRef.current?.clientWidth
    if (w) setBase(w)
  }, [])

  // What scale the user currently SEES, so stepping out of a fit mode continues smoothly.
  const effectiveScale = (z: ZoomState): number => {
    if (z.mode === 'manual') return z.scale
    if (z.mode === 'fit-width') return 1
    const displayed = canvasRef.current?.clientWidth
    return displayed ? displayed / base : 1
  }
  const applyZoom = (action: ZoomAction): void =>
    setZoom((z) => nextZoom(action, effectiveScale(z)))

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === '+' || e.key === '=') applyZoom('in')
      else if (e.key === '-') applyZoom('out')
      else if (e.key === 'w') applyZoom('fit-width')
      else if (e.key === 'p') applyZoom('fit-page')
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  })

  const manualWidth = zoom.mode === 'manual' ? Math.round(base * zoom.scale) : null
  useEffect(() => {
    if (canvasRef.current) {
      void renderThumb(pageIndex, canvasRef.current, manualWidth ?? base)
    }
  }, [pageIndex, renderThumb, manualWidth, base])

  const zoomButton = 'rounded border border-zinc-700 px-2 py-1 text-xs hover:bg-zinc-800'
  const fitClasses = (pressed: boolean): string =>
    clsx(zoomButton, pressed ? 'border-amber-700 bg-amber-950 text-amber-300' : 'text-zinc-300')

  return (
    <div
      role="dialog"
      aria-label="page view"
      className="absolute inset-0 z-30 flex flex-col bg-zinc-950/95 backdrop-blur"
    >
      <header className="flex items-center gap-3 border-b border-zinc-800 px-4 py-3">
        <h3 className="font-medium text-zinc-100">page {label}</h3>
        <div className="ml-auto flex items-center gap-2">
          <button aria-label="zoom out" onClick={() => applyZoom('out')} className={clsx(zoomButton, 'text-zinc-300')}>
            −
          </button>
          <button aria-label="zoom in" onClick={() => applyZoom('in')} className={clsx(zoomButton, 'text-zinc-300')}>
            +
          </button>
          <button
            aria-label="fit width"
            aria-pressed={zoom.mode === 'fit-width'}
            onClick={() => applyZoom('fit-width')}
            className={fitClasses(zoom.mode === 'fit-width')}
          >
            ↔
          </button>
          <button
            aria-label="fit page"
            aria-pressed={zoom.mode === 'fit-page'}
            onClick={() => applyZoom('fit-page')}
            className={fitClasses(zoom.mode === 'fit-page')}
          >
            ⤢
          </button>
          <button
            aria-label="open in source"
            onClick={() => onOpenPage(pageIndex)}
            className={clsx(zoomButton, 'text-zinc-300')}
          >
            open in source ↗
          </button>
          <button aria-label="close page view" onClick={onClose} className={clsx(zoomButton, 'text-zinc-300')}>
            ×
          </button>
        </div>
      </header>
      <div ref={containerRef} className="relative min-h-0 flex-1 overflow-auto p-4">
        <div className="flex min-h-full min-w-full items-center justify-center">
          <button
            aria-label="previous page"
            disabled={pageIndex <= 0}
            onClick={() => onNavigate(-1)}
            className="absolute left-2 top-1/2 z-10 -translate-y-1/2 rounded-full border border-zinc-700 bg-zinc-900/80 px-2 py-1 text-lg text-zinc-200 hover:bg-zinc-800 disabled:opacity-30"
          >
            ‹
          </button>
          <canvas
            ref={canvasRef}
            className={clsx(
              zoom.mode === 'fit-page' && 'max-h-full max-w-full',
              zoom.mode === 'fit-width' && 'h-auto w-full',
            )}
            style={manualWidth !== null ? { width: `${manualWidth}px` } : undefined}
          />
          <button
            aria-label="next page"
            disabled={pageIndex >= numPages - 1}
            onClick={() => onNavigate(1)}
            className="absolute right-2 top-1/2 z-10 -translate-y-1/2 rounded-full border border-zinc-700 bg-zinc-900/80 px-2 py-1 text-lg text-zinc-200 hover:bg-zinc-800 disabled:opacity-30"
          >
            ›
          </button>
        </div>
      </div>
    </div>
  )
}

/** One page thumbnail cell: placeholder (label on muted bg) until the observer promotes it. */
function PageCell({
  pageIndex,
  label,
  intensity,
  count,
  heatOn,
  cellWidth,
  compact,
  dimmed,
  rendered,
  renderThumb,
  register,
  onSelect,
}: {
  pageIndex: number
  label: string
  /** Continuous heat intensity (0, 1], or null when the page carries no heat. */
  intensity: number | null
  /** Annotation count for the badge; null = badge-less layer (read/exposure, or compact). */
  count: number | null
  heatOn: boolean
  cellWidth: number
  /** Bird's-eye overview size: page-aspect tiles, no label, hairline border. */
  compact: boolean
  /** Not a member of the applied page-range View — shown faint but still present (heat included). */
  dimmed: boolean
  rendered: boolean
  renderThumb: PdfDocumentState['renderThumb']
  register: (pageIndex: number, el: HTMLElement | null) => void
  onSelect: (pageIndex: number) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (rendered && canvasRef.current) void renderThumb(pageIndex, canvasRef.current, cellWidth)
  }, [rendered, renderThumb, pageIndex, cellWidth])

  return (
    <button
      ref={(el) => register(pageIndex, el)}
      data-page-index={pageIndex}
      aria-label={`page ${label}`}
      title={`page ${label} — open a larger view`}
      onClick={() => onSelect(pageIndex)}
      // A placeholder cell has no intrinsic height, so give it the page aspect (US-Letter-ish)
      // — that lets a compact grid shrink to true bird's-eye tiles instead of a 128px floor.
      style={{ aspectRatio: '17 / 22' }}
      className={clsx(
        'relative overflow-hidden bg-zinc-900/60 transition-opacity',
        compact ? 'rounded-sm border border-zinc-800/70' : 'rounded border border-zinc-800 hover:border-zinc-600',
        dimmed && 'opacity-35',
      )}
    >
      {rendered ? (
        <canvas ref={canvasRef} className="block h-auto w-full" />
      ) : (
        // In the compact overview the page number is illegible anyway — leave the tile bare.
        !compact && (
          <span className="absolute inset-0 flex items-center justify-center text-xs text-zinc-600">
            {label}
          </span>
        )
      )}
      {heatOn && intensity !== null && (
        <>
          <span
            data-heat={intensity.toFixed(4)}
            className="pointer-events-none absolute inset-0"
            style={{ backgroundColor: heatTint(intensity) }}
          />
          {count !== null && (
            <span className="absolute right-1 top-1 rounded-full bg-amber-500/90 px-1.5 text-[10px] font-semibold leading-4 text-zinc-950">
              {count}
            </span>
          )}
        </>
      )}
    </button>
  )
}
