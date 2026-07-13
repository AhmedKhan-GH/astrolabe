/**
 * Lightbox zoom transitions (docs/2026-07-13-r1-canvas-heat-zoom-spec §3). Pure — the
 * view supplies the EFFECTIVE scale (what a fit mode currently displays at, from container
 * size + page aspect), so stepping in/out of a fit mode continues smoothly from what the
 * user actually sees; that scale carries all the state a transition needs.
 */

export type ZoomMode = 'fit-width' | 'fit-page' | 'manual'
export interface ZoomState {
  mode: ZoomMode
  /** Multiplier over the container width; meaningful in `manual` mode (fit modes derive it). */
  scale: number
}
export type ZoomAction = 'in' | 'out' | 'fit-width' | 'fit-page'

export const ZOOM_MIN = 0.25
export const ZOOM_MAX = 4
const STEP = 1.25

const clamp = (scale: number): number => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, scale))

export function nextZoom(action: ZoomAction, effectiveScale: number): ZoomState {
  switch (action) {
    case 'fit-width':
      return { mode: 'fit-width', scale: 1 }
    case 'fit-page':
      return { mode: 'fit-page', scale: 1 }
    case 'in':
      return { mode: 'manual', scale: clamp(effectiveScale * STEP) }
    case 'out':
      return { mode: 'manual', scale: clamp(effectiveScale / STEP) }
  }
}
