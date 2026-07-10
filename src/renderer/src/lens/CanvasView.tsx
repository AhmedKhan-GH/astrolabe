import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import type { PdfDocumentState } from './pdf/usePdfDocument'
import { countsToTiers, type HeatTier } from './pdf/heat'
import type { PageAnnotations } from './types'

/** CSS width of one page cell (the spec's ~140px thumbnail column). */
const CELL_WIDTH = 140
/** Bounded canvas cache — beyond this, the oldest off-screen thumbnails revert to placeholders. */
const MAX_RENDERED = 200

/** Stepped tint per heat tier (existing Tailwind accent tones; amber = heat). */
const TIER_TINT: Record<Exclude<HeatTier, 'none'>, string> = {
  t1: 'bg-amber-500/10',
  t2: 'bg-amber-500/25',
  t3: 'bg-amber-500/40',
}

/**
 * Canvas view — every page of a PDF as a continuous thumbnail grid with an annotation
 * heat layer (docs/2026-07-10-canvas-view-spec §Renderer). Receives the pdf hook RESULT
 * as a prop so tests drive it without pdf.js; thumbnails render lazily via
 * IntersectionObserver (absent in jsdom → cells stay placeholders, by design).
 */
export function CanvasView({
  title,
  pdf,
  heat,
  onOpenPage,
  onClose,
}: {
  title: string
  pdf: PdfDocumentState
  /** Per-page annotation counts; null while the query is in flight (no heat layer yet). */
  heat: PageAnnotations | null
  onOpenPage: (pageIndex: number) => void
  onClose: () => void
}) {
  const [heatOn, setHeatOn] = useState(true)
  // Pages whose thumbnail canvas currently exists (LRU-bounded, see markVisible).
  const [rendered, setRendered] = useState<ReadonlySet<number>>(new Set())
  const renderOrder = useRef<number[]>([]) // insertion order — the eviction queue
  const visibleNow = useRef<Set<number>>(new Set()) // never evict what's on screen
  const observerRef = useRef<IntersectionObserver | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const tiers = useMemo(() => countsToTiers(heat?.pages ?? []), [heat])
  const counts = useMemo(() => {
    const m = new Map<number, number>()
    for (const p of heat?.pages ?? []) m.set(p.pageIndex, p.count)
    return m
  }, [heat])

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
            className="grid gap-2"
            style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${CELL_WIDTH}px, 1fr))` }}
          >
            {Array.from({ length: pdf.numPages }, (_, pageIndex) => (
              <PageCell
                key={pageIndex}
                pageIndex={pageIndex}
                label={pdf.pageLabels?.[pageIndex] ?? String(pageIndex + 1)}
                tier={tiers.get(pageIndex) ?? 'none'}
                count={counts.get(pageIndex) ?? 0}
                heatOn={heatOn}
                rendered={rendered.has(pageIndex)}
                renderThumb={pdf.renderThumb}
                register={registerCell}
                onOpenPage={onOpenPage}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/** One page thumbnail cell: placeholder (label on muted bg) until the observer promotes it. */
function PageCell({
  pageIndex,
  label,
  tier,
  count,
  heatOn,
  rendered,
  renderThumb,
  register,
  onOpenPage,
}: {
  pageIndex: number
  label: string
  tier: HeatTier
  count: number
  heatOn: boolean
  rendered: boolean
  renderThumb: PdfDocumentState['renderThumb']
  register: (pageIndex: number, el: HTMLElement | null) => void
  onOpenPage: (pageIndex: number) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (rendered && canvasRef.current) void renderThumb(pageIndex, canvasRef.current, CELL_WIDTH)
  }, [rendered, renderThumb, pageIndex])

  return (
    <button
      ref={(el) => register(pageIndex, el)}
      data-page-index={pageIndex}
      aria-label={`page ${label}`}
      title={`page ${label} — open in reader`}
      onClick={() => onOpenPage(pageIndex)}
      className="relative min-h-32 overflow-hidden rounded border border-zinc-800 bg-zinc-900/60 hover:border-zinc-600"
    >
      {rendered ? (
        <canvas ref={canvasRef} className="block h-auto w-full" />
      ) : (
        <span className="absolute inset-0 flex items-center justify-center text-xs text-zinc-600">
          {label}
        </span>
      )}
      {heatOn && tier !== 'none' && (
        <>
          <span className={clsx('pointer-events-none absolute inset-0', TIER_TINT[tier])} />
          <span className="absolute right-1 top-1 rounded-full bg-amber-500/90 px-1.5 text-[10px] font-semibold leading-4 text-zinc-950">
            {count}
          </span>
        </>
      )}
    </button>
  )
}
