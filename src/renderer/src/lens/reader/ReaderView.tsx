import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import './textLayer.css'
import type { PdfDocumentState } from '../pdf/usePdfDocument'
import { normalizeHeat } from '../pdf/heat'
import { nextZoom, type ZoomAction, type ZoomState } from '../pdf/zoom'
import type { DocPageView, PageAnnotations, ReadingState } from '../types'
import { createDwellTracker, type DwellTracker } from './dwell'
import { applyHighlights, clearHighlights, mapMatchesToSpans, readSpanTexts } from './highlight'
import { searchPages } from './search'
import { currentTocPath, flattenOutline, tocPageRanges, type OutlineEntry } from './toc'
import { TocSidebar } from './TocSidebar'
import { Minimap } from './Minimap'
import { ThumbStrip } from './ThumbStrip'

/** Minimap heat source: annotation breadth ('ann', default) or reading dwell ('read'). */
type HeatSource = 'ann' | 'read'

/** Base width when the scroll container cannot be measured (jsdom, first paint) — matches R1. */
const FALLBACK_BASE = 720
const FALLBACK_HEIGHT = 900
/** US-Letter-ish height/width; the placeholder aspect until getPageSize resolves (no jump). */
const DEFAULT_ASPECT = 1.294
/** Bounded rendered-page cache — beyond this, oldest off-screen pages revert to placeholders. */
const MAX_RENDERED = 40

/**
 * Continuous-scroll Reader (docs/2026-07-13-r2-reader-reading-state-spec §3). A vertical stack
 * of page cells, virtualized by a shared IntersectionObserver (jsdom has none → cells stay
 * placeholders, by design). Rendered cells rasterize via the injected pdf hook AND lay a
 * selectable pdf.js text layer over the canvas; a find bar searches page text (page-level
 * hits, R2); a second ≥50%-visibility observer + window focus/blur feed a dwell tracker whose
 * batched per-page EXPOSURE events (engagement time — never comprehension) flush every ~5s and
 * on unmount. Takes the pdf hook RESULT as a prop so tests drive it without pdf.js.
 */
export function ReaderView({
  title,
  pdf,
  reading,
  heat,
  views = [],
  appliedView = null,
  onRecordExposure,
  onToggleFinished,
  onTocSelectionChange,
  onSaveView,
  onApplyView,
  onDeleteView,
  onClose,
}: {
  title: string
  pdf: PdfDocumentState
  /** Persisted per-page exposure + finished marker; null while the query is in flight. */
  reading: ReadingState | null
  /** Per-page annotation aggregates for the minimap heat layer; null/absent = no annotation heat. */
  heat?: PageAnnotations | null
  /** Saved page-range Views for this document (host-provided). */
  views?: DocPageView[]
  /** The slug of the currently-applied View, or null — non-member pages dim while set. */
  appliedView?: string | null
  onRecordExposure: (events: { pageIndex: number; dwellMs: number; at: number }[]) => void
  onToggleFinished: (finished: boolean) => void
  /**
   * Fires when the TOC multi-select changes: the chosen section paths plus the union of their
   * page ranges (0-based). The integrator's Views UI consumes this to save a page-range View.
   */
  onTocSelectionChange?: (paths: Set<string>, pages: Set<number>) => void
  /** Save the current selection as a named View: (name, 0-based pages sorted, TOC-path provenance). */
  onSaveView?: (name: string, pages: number[], tocPaths: string[]) => void
  /** Apply a View by slug, or null to clear (show all pages). */
  onApplyView?: (slug: string | null) => void
  onDeleteView?: (slug: string) => void
  onClose: () => void
}) {
  const numPages = pdf.status === 'ready' ? pdf.numPages : 0
  const finished = reading?.finished ?? false

  const [findOpen, setFindOpen] = useState(false)
  const [layout, setLayout] = useState<'single' | 'spread'>('single')
  const [focus, setFocus] = useState(false)
  const [thumbs, setThumbs] = useState(false)
  const [viewsOpen, setViewsOpen] = useState(false)
  const [viewName, setViewName] = useState('')
  const [query, setQuery] = useState('')
  const [currentMatch, setCurrentMatch] = useState(0)
  const [pageTexts, setPageTexts] = useState<Map<number, string>>(new Map())
  const [sizes, setSizes] = useState<Map<number, { width: number; height: number }>>(new Map())
  const [rendered, setRendered] = useState<ReadonlySet<number>>(new Set())
  const [currentPage, setCurrentPage] = useState(0)
  const [zoom, setZoom] = useState<ZoomState>({ mode: 'fit-width', scale: 1 })
  const [base, setBase] = useState(FALLBACK_BASE)
  const [containerH, setContainerH] = useState(FALLBACK_HEIGHT)
  const [outline, setOutline] = useState<OutlineEntry[] | null>(null)
  const [tocCollapsed, setTocCollapsed] = useState(false)
  const [tocSelected, setTocSelected] = useState<Set<string>>(new Set())
  const [heatSource, setHeatSource] = useState<HeatSource>('ann')

  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const cellRefs = useRef(new Map<number, HTMLElement>())
  const renderOrder = useRef<number[]>([]) // insertion order — the eviction queue
  const visibleNow = useRef<Set<number>>(new Set()) // never evict what's on screen
  const dwellVisible = useRef<Set<number>>(new Set()) // pages ≥50% in view (drives currentPage)
  const virtualObs = useRef<IntersectionObserver | null>(null)
  const dwellObs = useRef<IntersectionObserver | null>(null)
  const sizeFetched = useRef<Set<number>>(new Set())

  // Stable handles for the observer callbacks (created once) to read the latest props.
  // Synced in effects — refs are off-limits during render (react-compiler).
  const getPageSizeRef = useRef(pdf.getPageSize)
  useEffect(() => {
    getPageSizeRef.current = pdf.getPageSize
  }, [pdf.getPageSize])
  const recordRef = useRef(onRecordExposure)
  useEffect(() => {
    recordRef.current = onRecordExposure
  }, [onRecordExposure])
  // Lazily created on first use inside effects/callbacks (never during render).
  const trackerRef = useRef<DwellTracker | null>(null)
  const tracker = useCallback(
    (): DwellTracker => (trackerRef.current ??= createDwellTracker(() => Date.now())),
    [],
  )

  // The zoom basis: the scroll container's content width, measured once (refs are off-limits
  // during render); the fixed fallbacks cover pre-layout and jsdom.
  useEffect(() => {
    const el = scrollRef.current
    if (el?.clientWidth) setBase(el.clientWidth - 32) // minus p-4 gutters
    if (el?.clientHeight) setContainerH(el.clientHeight)
  }, [])

  const displayWidth = useMemo(() => {
    if (zoom.mode === 'manual') return Math.round(base * zoom.scale)
    if (zoom.mode === 'fit-page') return Math.round(Math.min(base, containerH / DEFAULT_ASPECT))
    return base // fit-width
  }, [zoom, base, containerH])
  const applyZoom = (action: ZoomAction): void => setZoom(nextZoom(action, displayWidth / base))

  // In a two-page spread each page renders at half the display width; the page stack groups
  // into rows: the cover (pageIndex 0) alone, then facing pairs [1,2], [3,4], … Single layout
  // is one page per row, so the same row-map renders both modes.
  const pageWidth = layout === 'spread' ? Math.round(displayWidth / 2) : displayWidth
  const rows = useMemo(() => {
    if (layout !== 'spread') return Array.from({ length: numPages }, (_, i) => [i])
    const out: number[][] = []
    if (numPages > 0) out.push([0]) // the cover stands alone
    for (let i = 1; i < numPages; i += 2) out.push(i + 1 < numPages ? [i, i + 1] : [i])
    return out
  }, [layout, numPages])

  const textsArray = useMemo(
    () => Array.from({ length: numPages }, (_, i) => pageTexts.get(i) ?? null),
    [pageTexts, numPages],
  )
  const matches = useMemo(() => searchPages(textsArray, query), [textsArray, query])
  const totalHits = useMemo(() => matches.reduce((n, m) => n + m.count, 0), [matches])
  const activeHit = matches.length ? matches[Math.min(currentMatch, matches.length - 1)]! : null

  const pageLabel = (i: number): string => pdf.pageLabels?.[i] ?? String(i + 1)

  // Load the outline once the document is ready (optional hook member — guarded). Async
  // resolution mirrors the pageText load: the only setState is in the settled promise.
  useEffect(() => {
    if (pdf.status !== 'ready') return
    const getOutline = pdf.getOutline
    if (!getOutline) return
    let cancelled = false
    void getOutline().then((o) => {
      if (!cancelled) setOutline(o)
    })
    return () => {
      cancelled = true
    }
  }, [pdf.status, pdf.getOutline])

  const ranges = useMemo(
    () => tocPageRanges(flattenOutline(outline ?? []), numPages),
    [outline, numPages],
  )
  const hasOutline = !!outline && outline.length > 0 && ranges.size > 0
  const showToc = hasOutline && !tocCollapsed
  const tocCurrentPath = useMemo(() => currentTocPath(currentPage, ranges), [currentPage, ranges])

  // Minimap intensities under the active source, normalized document-relative (pdf/heat).
  const hasAnnHeat = (heat?.pages?.length ?? 0) > 0
  const hasReadHeat = reading ? Object.keys(reading.pages).length > 0 : false
  const hasHeatSource = hasAnnHeat || hasReadHeat
  // 'ann' is the default; fall back to whichever source actually has data.
  const effectiveSource: HeatSource =
    heatSource === 'read' ? (hasReadHeat ? 'read' : 'ann') : hasAnnHeat ? 'ann' : 'read'
  const intensities = useMemo(() => {
    const values =
      effectiveSource === 'read'
        ? Object.entries(reading?.pages ?? {}).map(([i, e]) => ({
            pageIndex: Number(i),
            value: e.dwellMs,
          }))
        : (heat?.pages ?? []).map((p) => ({ pageIndex: p.pageIndex, value: p.count }))
    return normalizeHeat(values)
  }, [effectiveSource, heat, reading])

  // Lazily fetch page text for the whole document once a search is active; cache in state.
  useEffect(() => {
    if (!findOpen || query === '' || pdf.status !== 'ready') return
    const getText = pdf.getPageText
    if (!getText) return
    for (let i = 0; i < numPages; i++) {
      if (pageTexts.has(i)) continue
      void getText(i).then((t) => setPageTexts((prev) => (prev.has(i) ? prev : new Map(prev).set(i, t))))
    }
  }, [findOpen, query, numPages, pdf.status, pdf.getPageText, pageTexts])

  // Live text-layer elements of the currently-rendered pages (registered by PageCell). Find-match
  // highlighting draws Ranges directly over these via the CSS Custom Highlight API (reader/
  // highlight.ts), leaving pdf.js's spans untouched.
  const textLayerEls = useRef(new Map<number, HTMLElement>())
  const registerTextLayer = useCallback((pageIndex: number, el: HTMLElement | null) => {
    if (el) textLayerEls.current.set(pageIndex, el)
    else textLayerEls.current.delete(pageIndex)
  }, [])

  // Re-highlight one page from its OWN span concatenation (which may differ from getPageText, so
  // the highlighted occurrences are best-effort vs the find bar's counts — the counts stay the
  // navigation source of truth). Navigation is page-level: `currentMatch` indexes hit *pages*, so
  // the active occurrence on the active page is its first (ordinal 0); other pages pass -1.
  const applyPageHighlights = useCallback(
    (pageIndex: number) => {
      if (!findOpen || query === '') return
      const el = textLayerEls.current.get(pageIndex)
      if (!el) return
      const slices = mapMatchesToSpans(readSpanTexts(el), query)
      applyHighlights(el, slices, activeHit?.pageIndex === pageIndex ? 0 : -1)
    },
    [findOpen, query, activeHit],
  )
  // A stable handle so PageCell's render effect doesn't re-run every keystroke (refs, not deps).
  const applyPageRef = useRef(applyPageHighlights)
  useEffect(() => {
    applyPageRef.current = applyPageHighlights
  }, [applyPageHighlights])
  const notifyTextLayerReady = useCallback((pageIndex: number) => {
    applyPageRef.current(pageIndex)
  }, [])

  // On query/active-match change, re-apply to every already-rendered page; clear all when the find
  // bar closes or the query empties. Pages rendered later apply via notifyTextLayerReady on render.
  useEffect(() => {
    if (!findOpen || query === '') {
      clearHighlights()
      return
    }
    for (const pageIndex of textLayerEls.current.keys()) applyPageHighlights(pageIndex)
  }, [findOpen, query, applyPageHighlights])
  // Belt-and-suspenders: drop every highlight when the Reader unmounts.
  useEffect(() => () => clearHighlights(), [])

  const scrollToPage = useCallback((pageIndex: number) => {
    cellRefs.current.get(pageIndex)?.scrollIntoView?.({ block: 'start', behavior: 'smooth' })
  }, [])

  // Toggle one section's membership in the TOC selection, then report the new selection plus the
  // union of its page ranges upward (the integrator's Views UI turns that into a saved View).
  const handleToggleSelect = useCallback(
    (path: string) => {
      const next = new Set(tocSelected)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      setTocSelected(next)
      const pages = new Set<number>()
      for (const p of next) {
        const r = ranges.get(p)
        if (r) for (let i = r.start; i <= r.end; i++) pages.add(i)
      }
      onTocSelectionChange?.(next, pages)
    },
    [tocSelected, ranges, onTocSelectionChange],
  )

  // The union of the currently-selected sections' page ranges (0-based, sorted) — the payload a
  // saved View captures, plus tocSelected as its provenance paths.
  const selectedPages = useMemo(() => {
    const pages = new Set<number>()
    for (const p of tocSelected) {
      const r = ranges.get(p)
      if (r) for (let i = r.start; i <= r.end; i++) pages.add(i)
    }
    return [...pages].sort((a, b) => a - b)
  }, [tocSelected, ranges])

  // Member pages of the applied View — non-members render dimmed; null = no View applied.
  const appliedPages = useMemo(() => {
    const v = views.find((x) => x.slug === appliedView)
    return v ? new Set(v.pages) : null
  }, [views, appliedView])

  const saveView = (): void => {
    if (selectedPages.length === 0) return
    onSaveView?.(viewName.trim() || 'Untitled view', selectedPages, [...tocSelected])
    setViewName('')
    setViewsOpen(false)
  }

  const stepMatch = useCallback(
    (delta: number) => {
      setCurrentMatch((i) => {
        if (matches.length === 0) return 0
        const next = (i + delta + matches.length) % matches.length
        scrollToPage(matches[next]!.pageIndex)
        return next
      })
    },
    [matches, scrollToPage],
  )

  const openFind = useCallback(() => {
    setFindOpen(true)
    queueMicrotask(() => inputRef.current?.focus())
  }, [])
  const closeFind = useCallback(() => {
    setFindOpen(false)
    setQuery('')
  }, [])

  // Global keys: ⌘F/Ctrl-F opens find; Escape closes the find bar FIRST, else the reader;
  // +/−/w/p drive zoom (ignored while typing in the find field so the query keeps its text).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault()
        openFind()
        return
      }
      if (e.key === 'Escape') {
        // Escape order: close the find bar first, else leave focus mode, else close the reader.
        if (findOpen) closeFind()
        else if (focus) setFocus(false)
        else onClose()
        return
      }
      if (e.target instanceof HTMLInputElement) return
      if (e.key === '+' || e.key === '=') applyZoom('in')
      else if (e.key === '-') applyZoom('out')
      else if (e.key === 'w') applyZoom('fit-width')
      else if (e.key === 'p') applyZoom('fit-page')
      else if (e.key === 'f') setFocus((v) => !v)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  })

  const markVisible = useCallback((pageIndex: number) => {
    setRendered((prev) => {
      if (prev.has(pageIndex)) return prev
      const next = new Set(prev)
      next.add(pageIndex)
      renderOrder.current.push(pageIndex)
      while (next.size > MAX_RENDERED && renderOrder.current.length > 0) {
        const idx = renderOrder.current.findIndex((p) => !visibleNow.current.has(p))
        if (idx === -1) break
        const [evicted] = renderOrder.current.splice(idx, 1)
        next.delete(evicted!)
      }
      return next
    })
  }, [])

  const ensureSize = useCallback((pageIndex: number) => {
    if (sizeFetched.current.has(pageIndex)) return
    const fn = getPageSizeRef.current
    if (!fn) return
    sizeFetched.current.add(pageIndex)
    void fn(pageIndex).then((s) => setSizes((prev) => new Map(prev).set(pageIndex, s)))
  }, [])

  // One virtualization observer (renders pages near the viewport) + one dwell observer
  // (≥50% visibility feeds the tracker and the page indicator). Guarded — jsdom has neither,
  // so every cell stays a placeholder and the tracker never fires (tests rely on both).
  const registerCell = useCallback(
    (pageIndex: number, el: HTMLElement | null) => {
      if (el) cellRefs.current.set(pageIndex, el)
      else cellRefs.current.delete(pageIndex)
      if (typeof IntersectionObserver === 'undefined') return
      virtualObs.current ??= new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            const page = Number((entry.target as HTMLElement).dataset.pageIndex)
            if (entry.isIntersecting) {
              visibleNow.current.add(page)
              markVisible(page)
              ensureSize(page)
            } else {
              visibleNow.current.delete(page)
            }
          }
        },
        { rootMargin: '1200px' },
      )
      dwellObs.current ??= new IntersectionObserver(
        (entries) => {
          const dwell = tracker()
          for (const entry of entries) {
            const page = Number((entry.target as HTMLElement).dataset.pageIndex)
            if (entry.isIntersecting && entry.intersectionRatio >= 0.5) {
              dwell.enter(page)
              dwellVisible.current.add(page)
            } else {
              dwell.leave(page)
              dwellVisible.current.delete(page)
            }
          }
          if (dwellVisible.current.size) setCurrentPage(Math.min(...dwellVisible.current))
        },
        { threshold: [0, 0.5, 1] },
      )
      if (el) {
        virtualObs.current.observe(el)
        dwellObs.current.observe(el)
      }
    },
    [markVisible, ensureSize, tracker],
  )
  useEffect(
    () => () => {
      virtualObs.current?.disconnect()
      dwellObs.current?.disconnect()
    },
    [],
  )

  // Dwell lifecycle: window focus/blur gate accrual; flush batches exposure every ~5s and a
  // final time on unmount (close) — only emitting when there is something to record.
  useEffect(() => {
    const dwell = tracker()
    if (typeof document !== 'undefined' && !document.hasFocus()) dwell.blur()
    const onFocus = (): void => dwell.focus()
    const onBlur = (): void => dwell.blur()
    window.addEventListener('focus', onFocus)
    window.addEventListener('blur', onBlur)
    const emit = (): void => {
      const events = dwell.flush()
      if (events.length) recordRef.current(events)
    }
    const id = window.setInterval(emit, 5000)
    return () => {
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('blur', onBlur)
      window.clearInterval(id)
      emit()
    }
  }, [tracker])

  const chip = 'rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800'

  return (
    <div
      role="dialog"
      aria-label="reader"
      className="fixed inset-y-0 right-0 z-20 flex w-[min(64rem,94vw)] flex-col border-l border-zinc-800 bg-zinc-950 shadow-2xl"
    >
      {!focus && (
      <header className="flex items-center gap-3 border-b border-zinc-800 px-4 py-3">
        <h2 className="min-w-0 truncate font-medium text-zinc-100">{title}</h2>
        {pdf.status === 'ready' && (
          <span className="shrink-0 text-xs text-zinc-500">
            {currentPage + 1} / {numPages}
          </span>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {hasOutline && (
            <button
              aria-label="table of contents"
              aria-pressed={showToc}
              title="Table of contents"
              onClick={() => setTocCollapsed((v) => !v)}
              className={clsx(chip, showToc && 'border-amber-700 bg-amber-950 text-amber-300')}
            >
              ☰
            </button>
          )}
          {pdf.status === 'ready' && (
            <div className="relative">
              <button
                aria-label="views"
                aria-pressed={appliedView !== null}
                title="Page-range views"
                onClick={() => setViewsOpen((v) => !v)}
                className={clsx(chip, appliedView !== null && 'border-amber-700 bg-amber-950 text-amber-300')}
              >
                Views
              </button>
              {viewsOpen && (
                <div className="absolute right-0 top-full z-40 mt-1 w-64 rounded border border-zinc-700 bg-zinc-900 p-2 shadow-xl">
                  {views.length === 0 ? (
                    <p className="px-1 py-1 text-xs text-zinc-500">No saved views yet.</p>
                  ) : (
                    <ul className="mb-2 flex flex-col gap-0.5">
                      {appliedView !== null && (
                        <li>
                          <button
                            aria-label="show all pages"
                            onClick={() => onApplyView?.(null)}
                            className="w-full rounded px-2 py-1 text-left text-xs text-zinc-400 hover:bg-zinc-800"
                          >
                            ▸ Show all pages
                          </button>
                        </li>
                      )}
                      {views.map((v) => (
                        <li key={v.slug} className="flex items-center gap-1">
                          <button
                            aria-label={`apply ${v.name}`}
                            aria-pressed={appliedView === v.slug}
                            onClick={() => onApplyView?.(appliedView === v.slug ? null : v.slug)}
                            className={clsx(
                              'min-w-0 flex-1 truncate rounded px-2 py-1 text-left text-xs',
                              appliedView === v.slug
                                ? 'bg-amber-950 text-amber-300'
                                : 'text-zinc-300 hover:bg-zinc-800',
                            )}
                          >
                            {v.name} <span className="text-zinc-600">· {v.pages.length}p</span>
                          </button>
                          <button
                            aria-label={`delete ${v.name}`}
                            onClick={() => onDeleteView?.(v.slug)}
                            className="rounded px-1.5 py-1 text-xs text-zinc-500 hover:bg-zinc-800 hover:text-red-400"
                          >
                            ×
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="flex items-center gap-1 border-t border-zinc-800 pt-2">
                    <input
                      type="text"
                      aria-label="new view name"
                      placeholder={selectedPages.length ? `${selectedPages.length} pages` : 'select in TOC'}
                      value={viewName}
                      onChange={(e) => setViewName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') saveView()
                      }}
                      className="min-w-0 flex-1 rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs text-zinc-100 outline-none focus:border-zinc-500"
                    />
                    <button
                      aria-label="save selection"
                      disabled={selectedPages.length === 0}
                      onClick={saveView}
                      className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800 disabled:opacity-30"
                    >
                      Save
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
          {hasHeatSource && (
            <span className="flex overflow-hidden rounded border border-zinc-700 text-xs">
              {(['ann', ...(hasReadHeat ? (['read'] as const) : [])] as HeatSource[]).map((s) => (
                <button
                  key={s}
                  aria-label={s === 'ann' ? 'minimap annotations' : 'minimap reading'}
                  aria-pressed={effectiveSource === s}
                  onClick={() => setHeatSource(s)}
                  className={clsx(
                    'px-2 py-1',
                    effectiveSource === s
                      ? 'bg-amber-950 text-amber-300'
                      : 'text-zinc-500 hover:bg-zinc-800',
                  )}
                >
                  {s === 'ann' ? 'notes' : 'read'}
                </button>
              ))}
            </span>
          )}
          <button
            aria-label="two-page spread"
            aria-pressed={layout === 'spread'}
            title="Two-page spread"
            onClick={() => setLayout((l) => (l === 'spread' ? 'single' : 'spread'))}
            className={clsx(chip, layout === 'spread' && 'border-amber-700 bg-amber-950 text-amber-300')}
          >
            ▤
          </button>
          <button
            aria-label="thumbnail strip"
            aria-pressed={thumbs}
            title="Thumbnail strip"
            onClick={() => setThumbs((v) => !v)}
            className={clsx(chip, thumbs && 'border-amber-700 bg-amber-950 text-amber-300')}
          >
            ▥
          </button>
          <button aria-label="focus mode" title="Focus mode (f)" onClick={() => setFocus(true)} className={chip}>
            ⛶
          </button>
          <button aria-label="zoom out" title="Zoom out" onClick={() => applyZoom('out')} className={chip}>
            −
          </button>
          <button aria-label="zoom in" title="Zoom in" onClick={() => applyZoom('in')} className={chip}>
            +
          </button>
          <button
            aria-label="fit width"
            aria-pressed={zoom.mode === 'fit-width'}
            title="Fit width (w)"
            onClick={() => applyZoom('fit-width')}
            className={clsx(chip, zoom.mode === 'fit-width' && 'border-amber-700 bg-amber-950 text-amber-300')}
          >
            ↔
          </button>
          <button
            aria-label="fit page"
            aria-pressed={zoom.mode === 'fit-page'}
            title="Fit page (p)"
            onClick={() => applyZoom('fit-page')}
            className={clsx(chip, zoom.mode === 'fit-page' && 'border-amber-700 bg-amber-950 text-amber-300')}
          >
            ⤢
          </button>
          <button aria-label="find in document" title="Find (⌘F)" onClick={openFind} className={chip}>
            ⌕
          </button>
          <button
            aria-label="finished"
            aria-pressed={finished}
            title="Mark this document read"
            onClick={() => onToggleFinished(!finished)}
            className={clsx(
              chip,
              finished && 'border-emerald-700 bg-emerald-950 text-emerald-300',
            )}
          >
            Finished
          </button>
          <button aria-label="close reader" onClick={onClose} className={chip}>
            ×
          </button>
        </div>
      </header>
      )}

      {findOpen && (
        <div
          data-testid="find-bar"
          className="flex items-center gap-3 border-b border-zinc-800 bg-zinc-900/60 px-4 py-2"
        >
          <input
            ref={inputRef}
            type="text"
            aria-label="find in document"
            placeholder="Find in document…"
            value={query}
            onChange={(e) => {
              // A fresh query restarts hit navigation from the top.
              setQuery(e.target.value)
              setCurrentMatch(0)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') stepMatch(e.shiftKey ? -1 : 1)
            }}
            className="w-64 rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm text-zinc-100 outline-none focus:border-zinc-500"
          />
          <span className="text-xs text-zinc-400">
            {query === '' ? (
              ''
            ) : matches.length === 0 ? (
              'No matches'
            ) : (
              <>
                {totalHits} {totalHits === 1 ? 'match' : 'matches'} on {matches.length}{' '}
                {matches.length === 1 ? 'page' : 'pages'}
                {activeHit && <span className="ml-2 text-zinc-500">page {pageLabel(activeHit.pageIndex)}</span>}
              </>
            )}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <button aria-label="previous match" onClick={() => stepMatch(-1)} className={chip}>
              ‹
            </button>
            <button aria-label="next match" onClick={() => stepMatch(1)} className={chip}>
              ›
            </button>
            <button aria-label="close find" onClick={closeFind} className={chip}>
              ×
            </button>
          </div>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {showToc && !focus && (
          <TocSidebar
            outline={outline}
            ranges={ranges}
            currentPath={tocCurrentPath}
            selected={tocSelected}
            onToggleSelect={handleToggleSelect}
            onNavigate={scrollToPage}
          />
        )}
        {pdf.status === 'ready' && thumbs && !focus && (
          <ThumbStrip
            numPages={numPages}
            pageLabel={pageLabel}
            currentPage={currentPage}
            renderThumb={pdf.renderThumb}
            onJump={scrollToPage}
          />
        )}
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto p-4">
          {pdf.status === 'loading' && <p className="text-sm text-zinc-600">loading PDF…</p>}
          {pdf.status === 'error' && (
            <p className="text-sm text-red-400">could not load PDF: {pdf.error}</p>
          )}
          {pdf.status === 'ready' && (
            <div className="mx-auto flex flex-col items-center gap-4">
              {rows.map((row) => (
                <div key={row[0]} className="flex items-start justify-center gap-4">
                  {row.map((pageIndex) => (
                    <PageCell
                      key={pageIndex}
                      pageIndex={pageIndex}
                      label={pageLabel(pageIndex)}
                      rendered={rendered.has(pageIndex)}
                      width={pageWidth}
                      size={sizes.get(pageIndex) ?? null}
                      dimmed={appliedPages !== null && !appliedPages.has(pageIndex)}
                      renderPage={pdf.renderPage}
                      register={registerCell}
                      registerTextLayer={registerTextLayer}
                      onTextLayerReady={notifyTextLayerReady}
                    />
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
        {pdf.status === 'ready' && numPages > 0 && !focus && (
          <Minimap
            numPages={numPages}
            intensities={intensities}
            currentPage={currentPage}
            onJump={scrollToPage}
          />
        )}
      </div>

      {focus && (
        <button
          aria-label="exit focus mode"
          title="Exit focus mode (Esc)"
          onClick={() => setFocus(false)}
          className="fixed right-4 top-4 z-30 rounded-full border border-zinc-700 bg-zinc-900/80 px-3 py-1.5 text-xs text-zinc-200 shadow-lg backdrop-blur hover:bg-zinc-800"
        >
          ⛶ exit
        </button>
      )}
    </div>
  )
}

/**
 * One page in the stack: a placeholder sized by the page's aspect ratio until the shared
 * observer promotes it, then a canvas with a selectable pdf.js text layer overlaid. The text
 * layer is styled per pdf.js conventions (absolute, transparent selectable spans) — the
 * `--total-scale-factor` var and span geometry are set by the hook's renderPage.
 */
function PageCell({
  pageIndex,
  label,
  rendered,
  width,
  size,
  dimmed,
  renderPage,
  register,
  registerTextLayer,
  onTextLayerReady,
}: {
  pageIndex: number
  label: string
  rendered: boolean
  width: number
  size: { width: number; height: number } | null
  /** Not a member of the applied page-range View — shown faint but still present. */
  dimmed: boolean
  renderPage: PdfDocumentState['renderPage']
  register: (pageIndex: number, el: HTMLElement | null) => void
  /** Register/deregister this page's text-layer element for find highlighting (optional). */
  registerTextLayer?: (pageIndex: number, el: HTMLElement | null) => void
  /** Fires once the text layer's spans are populated (renderPage resolved) so highlights apply. */
  onTextLayerReady?: (pageIndex: number) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const textRef = useRef<HTMLDivElement | null>(null)
  const aspect = size ? size.height / size.width : DEFAULT_ASPECT

  useEffect(() => {
    if (rendered && canvasRef.current && renderPage) {
      let cancelled = false
      // renderPage resolves only AFTER the pdf.js TextLayer has rendered its spans, so this is the
      // hook point to (re)apply find highlights over a now-populated layer.
      void renderPage(pageIndex, canvasRef.current, textRef.current, width).then(() => {
        if (!cancelled) onTextLayerReady?.(pageIndex)
      })
      return () => {
        cancelled = true
      }
    }
  }, [rendered, renderPage, pageIndex, width, onTextLayerReady])

  return (
    <div
      ref={(el) => register(pageIndex, el)}
      role="group"
      aria-label={`page ${label}`}
      data-page-index={pageIndex}
      className={clsx(
        'relative bg-zinc-900/40 shadow ring-1 ring-zinc-800 transition-opacity',
        dimmed && 'opacity-35',
      )}
      style={{ width, height: rendered ? undefined : Math.round(width * aspect) }}
    >
      {rendered ? (
        <>
          <canvas ref={canvasRef} className="block h-auto w-full" />
          {/* pdf.js text layer: transparent, selectable spans over the canvas (see textLayer.css). */}
          <div
            ref={(el) => {
              textRef.current = el
              registerTextLayer?.(pageIndex, el)
            }}
            aria-hidden
            className="textLayer"
          />
        </>
      ) : (
        <span className="absolute inset-0 flex items-center justify-center text-xs text-zinc-600">
          {label}
        </span>
      )}
    </div>
  )
}
