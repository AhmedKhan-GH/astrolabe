// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { ReaderView } from './ReaderView'
import type { PdfDocumentState } from '../pdf/usePdfDocument'

// The DOM side of highlighting is a guarded no-op in jsdom (no CSS.highlights), so we assert the
// WIRING — that ReaderView drives applyHighlights / clearHighlights at the module boundary — rather
// than any browser paint. The pure offset mapping is pinned separately in highlight.test.ts.
vi.mock('./highlight', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./highlight')>()
  return { ...actual, applyHighlights: vi.fn(), clearHighlights: vi.fn() }
})
import { applyHighlights, clearHighlights } from './highlight'

// A synchronous IntersectionObserver stub: reports every observed cell as fully visible the moment
// it is observed, so PageCells actually render (mount their text layers) in jsdom — jsdom ships no
// IntersectionObserver, and ReaderView leaves cells as placeholders without one.
class ImmediateIO {
  private cb: IntersectionObserverCallback
  constructor(cb: IntersectionObserverCallback) {
    this.cb = cb
  }
  observe(el: Element): void {
    this.cb(
      [{ target: el, isIntersecting: true, intersectionRatio: 1 } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    )
  }
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): IntersectionObserverEntry[] {
    return []
  }
}

beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', ImmediateIO as unknown as typeof IntersectionObserver)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

const pdf = (over: Partial<PdfDocumentState> = {}): PdfDocumentState => ({
  status: 'ready',
  numPages: 3,
  pageLabels: null,
  error: null,
  renderThumb: vi.fn().mockResolvedValue(undefined),
  renderPage: vi.fn().mockResolvedValue(undefined),
  getPageText: vi.fn((i: number) => Promise.resolve(`alpha page ${i}`)),
  getPageSize: vi.fn().mockResolvedValue({ width: 612, height: 792 }),
  ...over,
})

const setup = (): void => {
  render(
    <ReaderView
      title="t"
      pdf={pdf()}
      reading={null}
      onRecordExposure={vi.fn()}
      onToggleFinished={vi.fn()}
      onClose={vi.fn()}
    />,
  )
}

describe('ReaderView find highlighting wiring', () => {
  it('applies highlights over rendered text layers once a query is entered', async () => {
    setup()
    fireEvent.keyDown(document, { key: 'f', metaKey: true })
    fireEvent.change(screen.getByRole('textbox', { name: /find/i }), { target: { value: 'alpha' } })
    // Every rendered page's text layer is asked to highlight (a live HTMLElement + slices + active).
    await waitFor(() => expect(applyHighlights).toHaveBeenCalled())
    const [el, slices, activeIndex] = vi.mocked(applyHighlights).mock.calls[0]!
    expect(el).toBeInstanceOf(HTMLElement)
    expect(Array.isArray(slices)).toBe(true)
    expect(typeof activeIndex).toBe('number')
  })

  it('clears all highlights when the find bar closes', async () => {
    setup()
    fireEvent.keyDown(document, { key: 'f', metaKey: true })
    fireEvent.change(screen.getByRole('textbox', { name: /find/i }), { target: { value: 'alpha' } })
    await waitFor(() => expect(applyHighlights).toHaveBeenCalled())
    vi.mocked(clearHighlights).mockClear()
    fireEvent.click(screen.getByRole('button', { name: /close find/i }))
    expect(clearHighlights).toHaveBeenCalled()
  })
})
