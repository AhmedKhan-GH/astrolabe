import clsx from 'clsx'

/**
 * Above this page count the per-page-button strip is too heavy, so we fall back to a single
 * pointer-mapped strip (buttons stay the default because they're the accessible, testable path).
 */
const MAX_BUTTON_SLIVERS = 400

/** Continuous amber tint — the same rgba(245,158,11,α) convention CanvasView's heatTint uses. */
const MIN_ALPHA = 0.1
const MAX_ALPHA = 0.85
const tint = (intensity: number): string =>
  `rgba(245, 158, 11, ${(MIN_ALPHA + (MAX_ALPHA - MIN_ALPHA) * intensity).toFixed(3)})`

/**
 * The Reader's right-edge page minimap (docs/2026-07-13-r3-structure-views-spec §4, R3a): a thin
 * vertical strip, one sliver per page, tinted by the active heat source (annotation breadth or
 * reading dwell), with the current page marked. Clicking a sliver jumps the Reader to that page.
 * For documents up to MAX_BUTTON_SLIVERS pages every sliver is its own button (accessible +
 * testable); beyond that a single pointer-mapped strip keeps the DOM light.
 */
export function Minimap({
  numPages,
  intensities,
  currentPage,
  onJump,
}: {
  numPages: number
  /** 0-based pageIndex → continuous intensity (0, 1]; absent pages carry no tint. */
  intensities: Map<number, number>
  /** 0-based index of the page currently in view — its sliver is highlighted. */
  currentPage: number
  onJump: (pageIndex: number) => void
}) {
  if (numPages <= 0) return null

  if (numPages > MAX_BUTTON_SLIVERS) {
    // Pointer-mapped fallback: click position along the strip → proportional page.
    const jumpFromPointer = (e: React.MouseEvent<HTMLDivElement>): void => {
      const rect = e.currentTarget.getBoundingClientRect()
      if (rect.height <= 0) return
      const ratio = (e.clientY - rect.top) / rect.height
      const page = Math.max(0, Math.min(numPages - 1, Math.floor(ratio * numPages)))
      onJump(page)
    }
    const marker = numPages > 1 ? (currentPage / (numPages - 1)) * 100 : 0
    return (
      <nav
        aria-label="page minimap"
        className="relative w-3 shrink-0 cursor-pointer border-l border-zinc-800 bg-zinc-950"
        onClick={jumpFromPointer}
      >
        {Array.from(intensities.entries()).map(([pageIndex, intensity]) => (
          <span
            key={pageIndex}
            className="pointer-events-none absolute inset-x-0"
            style={{
              top: `${(pageIndex / numPages) * 100}%`,
              height: `${Math.max(0.4, 100 / numPages)}%`,
              backgroundColor: tint(intensity),
            }}
          />
        ))}
        <span
          className="pointer-events-none absolute inset-x-0 h-0.5 bg-amber-300"
          style={{ top: `${marker}%` }}
        />
      </nav>
    )
  }

  return (
    <nav
      aria-label="page minimap"
      className="flex w-3 shrink-0 flex-col border-l border-zinc-800 bg-zinc-950"
    >
      {Array.from({ length: numPages }, (_, pageIndex) => {
        const intensity = intensities.get(pageIndex)
        const isCurrent = pageIndex === currentPage
        return (
          <button
            key={pageIndex}
            type="button"
            aria-label={`go to page ${pageIndex + 1}`}
            aria-current={isCurrent ? 'location' : undefined}
            onClick={() => onJump(pageIndex)}
            className={clsx('min-h-[2px] flex-1', isCurrent && 'outline outline-1 outline-amber-300')}
            style={intensity !== undefined ? { backgroundColor: tint(intensity) } : undefined}
          />
        )
      })}
    </nav>
  )
}
