import { describe, it, expect } from 'vitest'
import { nextZoom, ZOOM_MAX, ZOOM_MIN, type ZoomState } from './zoom'

describe('nextZoom (lightbox zoom transitions)', () => {
  it('fit actions switch mode and reset scale', () => {
    expect(nextZoom('fit-width', 2)).toEqual({
      mode: 'fit-width',
      scale: 1,
    })
    expect(nextZoom('fit-page', 2)).toEqual({
      mode: 'fit-page',
      scale: 1,
    })
  })

  it('zooming in from a fit mode goes manual, stepping up from the EFFECTIVE scale', () => {
    // fit-page currently displaying at 0.6× container width → one step in lands at 0.75.
    expect(nextZoom('in', 0.6)).toEqual({
      mode: 'manual',
      scale: 0.75,
    })
  })

  it('zooming out steps down from the effective scale', () => {
    expect(nextZoom('out', 1)).toEqual({ mode: 'manual', scale: 0.8 })
  })

  it('in then out from the same point round-trips', () => {
    const zoomed = nextZoom('in', 1)
    const back = nextZoom('out', zoomed.scale)
    expect(back.scale).toBeCloseTo(1, 10)
  })

  it('clamps at the maximum', () => {
    let s: ZoomState = { mode: 'manual', scale: 1 }
    for (let i = 0; i < 20; i++) s = nextZoom('in', s.scale)
    expect(s.scale).toBe(ZOOM_MAX)
  })

  it('clamps at the minimum', () => {
    let s: ZoomState = { mode: 'manual', scale: 1 }
    for (let i = 0; i < 20; i++) s = nextZoom('out', s.scale)
    expect(s.scale).toBe(ZOOM_MIN)
  })
})
