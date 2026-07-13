// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import { ReaderView } from './ReaderView'
import type { PdfDocumentState } from '../pdf/usePdfDocument'
import type { ReadingState } from '../types'

afterEach(cleanup)

const PAGE_TEXT: Record<number, string> = {
  0: 'alpha beta',
  1: 'gamma delta',
  2: 'alpha alpha epsilon',
  3: 'zeta',
  4: 'eta',
}

// The hook RESULT is the injectable prop-shape; pdf.js never runs in jsdom, so cells stay
// placeholders (no IntersectionObserver) and the new members are plain mocks.
const pdf = (over: Partial<PdfDocumentState> = {}): PdfDocumentState => ({
  status: 'ready',
  numPages: 5,
  pageLabels: ['i', 'ii', '1', '2', '3'],
  error: null,
  renderThumb: vi.fn().mockResolvedValue(undefined),
  renderPage: vi.fn().mockResolvedValue(undefined),
  getPageText: vi.fn((i: number) => Promise.resolve(PAGE_TEXT[i] ?? '')),
  getPageSize: vi.fn().mockResolvedValue({ width: 612, height: 792 }),
  ...over,
})

const reading = (over: Partial<ReadingState> = {}): ReadingState => ({
  contentSha256: 'abc',
  pages: {},
  finished: false,
  finishedAt: null,
  updatedAt: '2026-07-13T00:00:00.000Z',
  ...over,
})

const setup = (over: Partial<Parameters<typeof ReaderView>[0]> = {}) => {
  const onRecordExposure = vi.fn()
  const onToggleFinished = vi.fn()
  const onClose = vi.fn()
  render(
    <ReaderView
      title="Probabilistic Machine Learning"
      pdf={pdf()}
      reading={null}
      onRecordExposure={onRecordExposure}
      onToggleFinished={onToggleFinished}
      onClose={onClose}
      {...over}
    />,
  )
  return { onRecordExposure, onToggleFinished, onClose }
}

describe('ReaderView header', () => {
  it('shows the title and the page position indicator', () => {
    setup()
    expect(screen.getByText('Probabilistic Machine Learning')).toBeTruthy()
    expect(screen.getByText(/1\s*\/\s*5/)).toBeTruthy()
  })

  it('the close button closes', () => {
    const { onClose } = setup()
    fireEvent.click(screen.getByRole('button', { name: /close reader/i }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('Escape closes when the find bar is shut', () => {
    const { onClose } = setup()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('never labels exposure as comprehension', () => {
    setup()
    expect(document.body.textContent).not.toMatch(/understood/i)
  })
})

describe('ReaderView finished toggle', () => {
  it('is unpressed with no reading state and marks finished on click', () => {
    const { onToggleFinished } = setup({ reading: null })
    const toggle = screen.getByRole('button', { name: /finished/i })
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(toggle)
    expect(onToggleFinished).toHaveBeenCalledWith(true)
  })

  it('reflects a finished reading state and un-marks on click', () => {
    const { onToggleFinished } = setup({ reading: reading({ finished: true, finishedAt: 'x' }) })
    const toggle = screen.getByRole('button', { name: /finished/i })
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(toggle)
    expect(onToggleFinished).toHaveBeenCalledWith(false)
  })
})

describe('ReaderView page cells', () => {
  it('renders a placeholder cell per page, labelled by pageLabel', () => {
    setup()
    for (const label of ['i', 'ii', '1', '2', '3']) {
      expect(screen.getByRole('group', { name: `page ${label}` })).toBeTruthy()
    }
  })

  it('falls back to 1-based numbers when there are no pageLabels', () => {
    setup({ pdf: pdf({ numPages: 3, pageLabels: null }) })
    for (const label of ['1', '2', '3']) {
      expect(screen.getByRole('group', { name: `page ${label}` })).toBeTruthy()
    }
  })

  it('shows loading and error states in place of cells', () => {
    setup({ pdf: pdf({ status: 'loading', numPages: 0, pageLabels: null }) })
    expect(screen.getByText(/loading/i)).toBeTruthy()
    cleanup()
    setup({ pdf: pdf({ status: 'error', numPages: 0, pageLabels: null, error: 'boom' }) })
    expect(screen.getByText(/boom/)).toBeTruthy()
  })
})

describe('ReaderView zoom', () => {
  it('defaults to fit-width and steps to manual on zoom in, back on w', () => {
    setup()
    const fitWidth = screen.getByRole('button', { name: /fit width/i })
    expect(fitWidth.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: /zoom in/i }))
    expect(fitWidth.getAttribute('aria-pressed')).toBe('false')
    fireEvent.keyDown(document, { key: 'w' })
    expect(fitWidth.getAttribute('aria-pressed')).toBe('true')
  })
})

describe('ReaderView find bar', () => {
  it('opens with ⌘F and closes on Escape before the reader does', () => {
    const { onClose } = setup()
    expect(screen.queryByRole('textbox', { name: /find/i })).toBeNull()
    fireEvent.keyDown(document, { key: 'f', metaKey: true })
    expect(screen.getByRole('textbox', { name: /find/i })).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('textbox', { name: /find/i })).toBeNull()
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('counts page-level matches and steps through hit pages', async () => {
    setup()
    fireEvent.keyDown(document, { key: 'f', ctrlKey: true })
    const input = screen.getByRole('textbox', { name: /find/i })
    fireEvent.change(input, { target: { value: 'alpha' } })
    // 3 occurrences (page 0 ×1, page 2 ×2) across 2 pages.
    expect(await screen.findByText(/3 matches on 2 pages/i)).toBeTruthy()
    // First hit page is 'i' (pageIndex 0); Next advances to '1' (pageIndex 2), then wraps.
    const bar = screen.getByTestId('find-bar')
    expect(within(bar).getByText(/page i\b/)).toBeTruthy()
    fireEvent.click(within(bar).getByRole('button', { name: /next match/i }))
    expect(within(bar).getByText(/page 1\b/)).toBeTruthy()
    fireEvent.click(within(bar).getByRole('button', { name: /next match/i }))
    expect(within(bar).getByText(/page i\b/)).toBeTruthy()
  })

  it('shows a no-match state for a query that hits nothing', async () => {
    setup()
    fireEvent.keyDown(document, { key: 'f', metaKey: true })
    fireEvent.change(screen.getByRole('textbox', { name: /find/i }), {
      target: { value: 'zzzznope' },
    })
    expect(await screen.findByText(/no matches/i)).toBeTruthy()
  })
})
