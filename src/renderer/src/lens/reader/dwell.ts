/**
 * Pure per-page dwell tracker (docs/2026-07-13-r2-reader-reading-state-spec §3). A page
 * accrues time ONLY while it is entered (≥50% in view) AND the window is focused; either
 * condition dropping stops its clock. `flush()` returns one batched event per page that
 * accrued time and resets those accumulators — the main-process merge counts one visit per
 * event, so at most one event per page per flush. Time is injected via `now()` so the whole
 * thing is deterministic and DOM-free; the ReaderView wires enter/leave to an
 * IntersectionObserver, focus/blur to the window, and calls flush on an interval + unmount.
 */

export interface DwellEvent {
  pageIndex: number
  dwellMs: number
  at: number
}

/** Per-page dwell is capped here so an open-overnight window can't report a false marathon. */
const MAX_DWELL_MS = 600_000

export interface DwellTracker {
  enter: (pageIndex: number) => void
  leave: (pageIndex: number) => void
  focus: () => void
  blur: () => void
  /** Emit + reset accrued dwell; pages still entered/focused keep accruing from now on. */
  flush: () => DwellEvent[]
}

export function createDwellTracker(now: () => number): DwellTracker {
  const entered = new Set<number>()
  const accumulated = new Map<number, number>() // pageIndex → ms banked since last flush
  const activeSince = new Map<number, number>() // pageIndex → clock start, only while accruing
  let focused = true

  const isActive = (pageIndex: number): boolean => focused && entered.has(pageIndex)

  // Reconcile one page's clock with its current active state, banking any elapsed time.
  const refresh = (pageIndex: number, t: number): void => {
    const since = activeSince.get(pageIndex)
    const active = isActive(pageIndex)
    if (since !== undefined) {
      const banked = Math.min(MAX_DWELL_MS, (accumulated.get(pageIndex) ?? 0) + (t - since))
      accumulated.set(pageIndex, banked)
      if (active) activeSince.set(pageIndex, t) // still active — restart the clock from now
      else activeSince.delete(pageIndex)
    } else if (active) {
      activeSince.set(pageIndex, t)
    }
  }

  return {
    enter(pageIndex) {
      entered.add(pageIndex)
      refresh(pageIndex, now())
    },
    leave(pageIndex) {
      const t = now()
      entered.delete(pageIndex)
      refresh(pageIndex, t)
    },
    focus() {
      const t = now()
      focused = true
      for (const pageIndex of entered) refresh(pageIndex, t)
    },
    blur() {
      const t = now()
      focused = false
      for (const pageIndex of entered) refresh(pageIndex, t)
    },
    flush() {
      const t = now()
      for (const pageIndex of activeSince.keys()) refresh(pageIndex, t)
      const events: DwellEvent[] = []
      for (const [pageIndex, ms] of accumulated) {
        const dwellMs = Math.min(MAX_DWELL_MS, Math.round(ms))
        if (dwellMs > 0) events.push({ pageIndex, dwellMs, at: t })
      }
      accumulated.clear()
      return events
    },
  }
}
