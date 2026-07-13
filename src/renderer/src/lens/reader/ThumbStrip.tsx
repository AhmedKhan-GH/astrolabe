import { useCallback, useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import type { PdfDocumentState } from '../pdf/usePdfDocument'

/** Content width (CSS px) rendered into each thumbnail — the w-24 rail minus its p-2 gutters. */
const THUMB_WIDTH = 80

/**
 * The Reader's left thumbnail rail (docs/2026-07-13-r3c-reader-completion-spec §Scope 2): a thin
 * scrollable column of lazily-rasterized page thumbnails. The current page is ringed; clicking a
 * thumb scrolls the main page stack to it. Thumbnails render lazily via a shared
 * IntersectionObserver — absent in jsdom, so every thumb stays a labelled placeholder, by design
 * (the same guard CanvasView/ReaderView use so tests never touch pdf.js).
 */
export function ThumbStrip({
  numPages,
  pageLabel,
  currentPage,
  renderThumb,
  onJump,
}: {
  numPages: number
  pageLabel: (pageIndex: number) => string
  /** 0-based index of the page currently in view — its thumb is ringed. */
  currentPage: number
  renderThumb: PdfDocumentState['renderThumb']
  onJump: (pageIndex: number) => void
}) {
  const [rendered, setRendered] = useState<ReadonlySet<number>>(new Set())
  const observerRef = useRef<IntersectionObserver | null>(null)

  const markVisible = useCallback((pageIndex: number) => {
    setRendered((prev) => (prev.has(pageIndex) ? prev : new Set(prev).add(pageIndex)))
  }, [])

  // One shared observer; thumbs register their element on mount. Guarded because jsdom has no
  // IntersectionObserver — there every thumb stays a placeholder (tests rely on it).
  const registerThumb = useCallback(
    (el: HTMLElement | null) => {
      if (typeof IntersectionObserver === 'undefined') return
      observerRef.current ??= new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting) markVisible(Number((entry.target as HTMLElement).dataset.pageIndex))
          }
        },
        { rootMargin: '400px' },
      )
      if (el) observerRef.current.observe(el)
    },
    [markVisible],
  )
  useEffect(() => () => observerRef.current?.disconnect(), [])

  return (
    <nav
      aria-label="page thumbnails"
      className="w-24 shrink-0 overflow-y-auto border-r border-zinc-800 bg-zinc-950 p-2"
    >
      <div className="flex flex-col gap-2">
        {Array.from({ length: numPages }, (_, pageIndex) => (
          <ThumbCell
            key={pageIndex}
            pageIndex={pageIndex}
            label={pageLabel(pageIndex)}
            current={pageIndex === currentPage}
            rendered={rendered.has(pageIndex)}
            renderThumb={renderThumb}
            register={registerThumb}
            onJump={onJump}
          />
        ))}
      </div>
    </nav>
  )
}

/** One thumbnail: a labelled placeholder until the observer promotes it, then a small canvas. */
function ThumbCell({
  pageIndex,
  label,
  current,
  rendered,
  renderThumb,
  register,
  onJump,
}: {
  pageIndex: number
  label: string
  current: boolean
  rendered: boolean
  renderThumb: PdfDocumentState['renderThumb']
  register: (el: HTMLElement | null) => void
  onJump: (pageIndex: number) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (rendered && canvasRef.current) void renderThumb(pageIndex, canvasRef.current, THUMB_WIDTH)
  }, [rendered, renderThumb, pageIndex])

  return (
    <button
      ref={register}
      data-page-index={pageIndex}
      aria-label={`go to page ${label}`}
      aria-current={current ? 'true' : undefined}
      title={`page ${label}`}
      onClick={() => onJump(pageIndex)}
      // Page-aspect (US-Letter-ish) so a placeholder still shows a true page-shaped tile.
      style={{ aspectRatio: '17 / 22' }}
      className={clsx(
        'relative w-full overflow-hidden rounded border bg-zinc-900/60',
        current
          ? 'border-amber-500 ring-2 ring-amber-500'
          : 'border-zinc-800 hover:border-zinc-600',
      )}
    >
      {rendered ? (
        <canvas ref={canvasRef} className="block h-auto w-full" />
      ) : (
        <span className="absolute inset-0 flex items-center justify-center text-[10px] text-zinc-600">
          {label}
        </span>
      )}
    </button>
  )
}
