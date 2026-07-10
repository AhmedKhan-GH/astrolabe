// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import { CanvasView } from './CanvasView'
import type { PdfDocumentState } from './pdf/usePdfDocument'
import type { PageAnnotations } from './types'

afterEach(cleanup)

// The hook RESULT is the injectable prop-shape — pdf.js itself never runs in jsdom.
const pdf = (over: Partial<PdfDocumentState> = {}): PdfDocumentState => ({
  status: 'ready',
  numPages: 5,
  pageLabels: ['i', 'ii', '1', '2', '3'],
  error: null,
  renderThumb: vi.fn().mockResolvedValue(undefined),
  ...over,
})

const heat: PageAnnotations = {
  pages: [
    { pageIndex: 1, count: 1 },
    { pageIndex: 3, count: 5 },
  ],
}

const setup = (over: Partial<Parameters<typeof CanvasView>[0]> = {}) => {
  const onOpenPage = vi.fn()
  const onClose = vi.fn()
  render(
    <CanvasView
      title="Probabilistic Machine Learning"
      pdf={pdf()}
      heat={heat}
      onOpenPage={onOpenPage}
      onClose={onClose}
      {...over}
    />,
  )
  return { onOpenPage, onClose }
}

describe('CanvasView header', () => {
  it('shows the title and page count', () => {
    setup()
    expect(screen.getByText('Probabilistic Machine Learning')).toBeTruthy()
    expect(screen.getByText(/5 pages/)).toBeTruthy()
  })

  it('the × button closes', () => {
    const { onClose } = setup()
    fireEvent.click(screen.getByRole('button', { name: /close canvas/i }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('Escape closes', () => {
    const { onClose } = setup()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
  })
})

describe('CanvasView page cells', () => {
  it('renders a placeholder cell per page, labelled by pageLabel', () => {
    setup()
    for (const label of ['i', 'ii', '1', '2', '3']) {
      expect(screen.getByRole('button', { name: `page ${label}` })).toBeTruthy()
    }
  })

  it('falls back to 1-based numbers when the PDF has no pageLabels', () => {
    setup({ pdf: pdf({ numPages: 3, pageLabels: null }) })
    for (const label of ['1', '2', '3']) {
      expect(screen.getByRole('button', { name: `page ${label}` })).toBeTruthy()
    }
  })

  it('clicking a cell fires onOpenPage with the 0-based page index', () => {
    const { onOpenPage } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'page 1' })) // 3rd page → index 2
    expect(onOpenPage).toHaveBeenCalledWith(2)
  })

  it('shows a loading state instead of cells while the PDF loads', () => {
    setup({ pdf: pdf({ status: 'loading', numPages: 0, pageLabels: null }) })
    expect(screen.getByText(/loading/i)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^page / })).toBeNull()
  })

  it('surfaces a load error', () => {
    setup({ pdf: pdf({ status: 'error', numPages: 0, pageLabels: null, error: 'boom' }) })
    expect(screen.getByText(/boom/)).toBeTruthy()
  })
})

describe('CanvasView heat layer', () => {
  it('shows a count badge on annotated pages only', () => {
    setup()
    const annotated = screen.getByRole('button', { name: 'page ii' }) // pageIndex 1, count 1
    const heavy = screen.getByRole('button', { name: 'page 2' }) // pageIndex 3, count 5
    const plain = screen.getByRole('button', { name: 'page i' }) // pageIndex 0
    expect(within(annotated).getByText('1')).toBeTruthy()
    expect(within(heavy).getByText('5')).toBeTruthy()
    expect(within(plain).queryByText(/^\d+$/)).toBeNull()
  })

  it('the Annotations toggle hides the heat layer', () => {
    setup()
    const toggle = screen.getByRole('button', { name: 'Annotations' })
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
    const heavy = screen.getByRole('button', { name: 'page 2' })
    expect(within(heavy).queryByText('5')).toBeNull()
  })

  it('renders no badges when heat data is still loading (null)', () => {
    setup({ heat: null })
    const cell = screen.getByRole('button', { name: 'page 2' }) // would carry count 5
    expect(within(cell).queryByText('5')).toBeNull()
  })
})
