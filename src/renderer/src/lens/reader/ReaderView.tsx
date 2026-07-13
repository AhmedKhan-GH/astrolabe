import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import './textLayer.css'
import type { PdfDocumentState } from '../pdf/usePdfDocument'
import { nextZoom, type ZoomAction, type ZoomState } from '../pdf/zoom'
import type { ReadingState } from '../types'
import { createDwellTracker, type DwellTracker } from './dwell'
import { searchPages } from './search'

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
  onRecordExposure,
  onToggleFinished,
  onClose,
}: {
  title: string
  pdf: PdfDocumentState
  /** Persisted per-page exposure + finished marker; null while the query is in flight. */
  reading: ReadingState | null
  onRecordExposure: (events: { pageIndex: number; dwellMs: number; at: number }[]) => void
  onToggleFinished: (finished: boolean) => void
  onClose: () => void
}) {
  const numPages = pdf.status === 'ready' ? pdf.numPages : 0
  const finished = reading?.finished ?? false

  const [findOpen, setFindOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [currentMatch, setCurrentMatch] = useState(0)
  const [pageTexts, setPageTexts] = useState<Map<number, string>>(new Map())
  const [sizes, setSizes] = useState<Map<number, { width: number; height: number }>>(new Map())
  const [rendered, setRendered] = useState<ReadonlySet<number>>(new Set())
  const [currentPage, setCurrentPage] = useState(0)
  const [zoom, setZoom] = useState<ZoomState>({ mode: 'fit-width', scale: 1 })
  const [base, setBase] = useState(FALLBACK_BASE)
  const [containerH, setContainerH] = useState(FALLBACK_HEIGHT)

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

  const textsArray = useMemo(
    () => Array.from({ length: numPages }, (_, i) => pageTexts.get(i) ?? null),
    [pageTexts, numPages],
  )
  const matches = useMemo(() => searchPages(textsArray, query), [textsArray, query])
  const totalHits = useMemo(() => matches.reduce((n, m) => n + m.count, 0), [matches])
  const activeHit = matches.length ? matches[Math.min(currentMatch, matches.length - 1)]! : null

  const pageLabel = (i: number): string => pdf.pageLabels?.[i] ?? String(i + 1)

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


  const scrollToPage = useCallback((pageIndex: number) => {
    cellRefs.current.get(pageIndex)?.scrollIntoView?.({ block: 'start', behavior: 'smooth' })
  }, [])

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
        if (findOpen) closeFind()
        else onClose()
        return
      }
      if (e.target instanceof HTMLInputElement) return
      if (e.key === '+' || e.key === '=') applyZoom('in')
      else if (e.key === '-') applyZoom('out')
      else if (e.key === 'w') applyZoom('fit-width')
      else if (e.key === 'p') applyZoom('fit-page')
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
      <header className="flex items-center gap-3 border-b border-zinc-800 px-4 py-3">
        <h2 className="min-w-0 truncate font-medium text-zinc-100">{title}</h2>
        {pdf.status === 'ready' && (
          <span className="shrink-0 text-xs text-zinc-500">
            {currentPage + 1} / {numPages}
          </span>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-2">
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

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto p-4">
        {pdf.status === 'loading' && <p className="text-sm text-zinc-600">loading PDF…</p>}
        {pdf.status === 'error' && (
          <p className="text-sm text-red-400">could not load PDF: {pdf.error}</p>
        )}
        {pdf.status === 'ready' && (
          <div className="mx-auto flex flex-col items-center gap-4">
            {Array.from({ length: numPages }, (_, pageIndex) => (
              <PageCell
                key={pageIndex}
                pageIndex={pageIndex}
                label={pageLabel(pageIndex)}
                rendered={rendered.has(pageIndex)}
                width={displayWidth}
                size={sizes.get(pageIndex) ?? null}
                renderPage={pdf.renderPage}
                register={registerCell}
              />
            ))}
          </div>
        )}
      </div>
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
  renderPage,
  register,
}: {
  pageIndex: number
  label: string
  rendered: boolean
  width: number
  size: { width: number; height: number } | null
  renderPage: PdfDocumentState['renderPage']
  register: (pageIndex: number, el: HTMLElement | null) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const textRef = useRef<HTMLDivElement>(null)
  const aspect = size ? size.height / size.width : DEFAULT_ASPECT

  useEffect(() => {
    if (rendered && canvasRef.current && renderPage) {
      void renderPage(pageIndex, canvasRef.current, textRef.current, width)
    }
  }, [rendered, renderPage, pageIndex, width])

  return (
    <div
      ref={(el) => register(pageIndex, el)}
      role="group"
      aria-label={`page ${label}`}
      data-page-index={pageIndex}
      className="relative bg-zinc-900/40 shadow ring-1 ring-zinc-800"
      style={{ width, height: rendered ? undefined : Math.round(width * aspect) }}
    >
      {rendered ? (
        <>
          <canvas ref={canvasRef} className="block h-auto w-full" />
          {/* pdf.js text layer: transparent, selectable spans over the canvas (see textLayer.css). */}
          <div ref={textRef} aria-hidden className="textLayer" />
        </>
      ) : (
        <span className="absolute inset-0 flex items-center justify-center text-xs text-zinc-600">
          {label}
        </span>
      )}
    </div>
  )
}
