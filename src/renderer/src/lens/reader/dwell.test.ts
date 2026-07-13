import { describe, it, expect } from 'vitest'
import { createDwellTracker } from './dwell'

/** A controllable clock: tests advance `t` and pass `() => t` as the tracker's now(). */
function clock(start = 0) {
  let t = start
  return { now: () => t, advance: (ms: number) => (t += ms) }
}

describe('createDwellTracker', () => {
  it('accumulates in-view, focused time and flushes one event per page', () => {
    const c = clock()
    const d = createDwellTracker(c.now)
    d.enter(2) // window is focused by default
    c.advance(1000)
    const events = d.flush()
    expect(events).toEqual([{ pageIndex: 2, dwellMs: 1000, at: 1000 }])
  })

  it('does not accumulate while the window is blurred', () => {
    const c = clock()
    const d = createDwellTracker(c.now)
    d.blur()
    d.enter(0)
    c.advance(5000) // entered but blurred → nothing
    expect(d.flush()).toEqual([])
    d.focus()
    c.advance(2000) // now entered AND focused
    expect(d.flush()).toEqual([{ pageIndex: 0, dwellMs: 2000, at: 7000 }])
  })

  it('stops accumulating after leave', () => {
    const c = clock()
    const d = createDwellTracker(c.now)
    d.enter(1)
    c.advance(1000)
    d.leave(1)
    c.advance(4000) // left → no more accrual
    expect(d.flush()).toEqual([{ pageIndex: 1, dwellMs: 1000, at: 5000 }])
  })

  it('tracks several pages independently', () => {
    const c = clock()
    const d = createDwellTracker(c.now)
    d.enter(0)
    c.advance(1000)
    d.enter(1) // both now in view (a spread / overlap)
    c.advance(2000)
    d.leave(0)
    c.advance(500)
    const events = d.flush().sort((a, b) => a.pageIndex - b.pageIndex)
    expect(events).toEqual([
      { pageIndex: 0, dwellMs: 3000, at: 3500 },
      { pageIndex: 1, dwellMs: 2500, at: 3500 },
    ])
  })

  it('flush resets accumulators; a second flush with no new dwell is empty', () => {
    const c = clock()
    const d = createDwellTracker(c.now)
    d.enter(3)
    c.advance(1000)
    d.flush()
    d.leave(3)
    expect(d.flush()).toEqual([])
  })

  it('keeps accumulating across a flush while still entered and focused', () => {
    const c = clock()
    const d = createDwellTracker(c.now)
    d.enter(4)
    c.advance(1000)
    expect(d.flush()).toEqual([{ pageIndex: 4, dwellMs: 1000, at: 1000 }])
    c.advance(2000) // still in view — the clock keeps running
    expect(d.flush()).toEqual([{ pageIndex: 4, dwellMs: 2000, at: 3000 }])
  })

  it('caps a single page accumulation at 600_000ms (open-overnight guard)', () => {
    const c = clock()
    const d = createDwellTracker(c.now)
    d.enter(0)
    c.advance(3_600_000) // an hour in view without a flush
    expect(d.flush()).toEqual([{ pageIndex: 0, dwellMs: 600_000, at: 3_600_000 }])
  })

  it('omits pages with zero dwell', () => {
    const c = clock()
    const d = createDwellTracker(c.now)
    d.enter(0)
    d.leave(0) // entered and left within the same instant
    expect(d.flush()).toEqual([])
  })
})
