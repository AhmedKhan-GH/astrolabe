// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import { ReaderView } from './ReaderView'
import type { PdfDocumentState } from '../pdf/usePdfDocument'
import type { DocPageView, PageAnnotations, ReadingState } from '../types'
import type { OutlineEntry } from './toc'

afterEach(cleanup)

// Intro [0,2] with child Background [1,2]; Methods [3,4] — over the 5-page fixture.
const OUTLINE: OutlineEntry[] = [
  {
    title: 'Intro',
    pageIndex: 0,
    children: [{ title: 'Background', pageIndex: 1, children: [] }],
  },
  { title: 'Methods', pageIndex: 3, children: [] },
]

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

describe('ReaderView TOC sidebar', () => {
  const withOutline = (o: OutlineEntry[] = OUTLINE): Partial<PdfDocumentState> => ({
    getOutline: vi.fn().mockResolvedValue(o),
  })

  it('shows a TOC sidebar when an outline resolves, and the header toggle hides it', async () => {
    setup({ pdf: pdf(withOutline()) })
    const toggle = await screen.findByRole('button', { name: /table of contents/i })
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('navigation', { name: /table of contents/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Intro' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Methods' })).toBeTruthy()
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
    expect(screen.queryByRole('navigation', { name: /table of contents/i })).toBeNull()
  })

  it('hides the TOC toggle entirely when the document has no outline', async () => {
    setup({ pdf: pdf(withOutline([])) })
    // Let the async getOutline settle, then confirm no toggle appeared.
    await Promise.resolve()
    expect(screen.queryByRole('button', { name: /table of contents/i })).toBeNull()
    expect(screen.queryByRole('navigation', { name: /table of contents/i })).toBeNull()
  })

  it('reports a TOC selection upward with the union of its page ranges', async () => {
    const onTocSelectionChange = vi.fn()
    setup({ pdf: pdf(withOutline()), onTocSelectionChange })
    const box = await screen.findByRole('checkbox', { name: /select Methods/i })
    fireEvent.click(box) // Methods = /1, range [3,4]
    expect(onTocSelectionChange).toHaveBeenCalledWith(new Set(['/1']), new Set([3, 4]))
  })
})

describe('ReaderView page-range Views', () => {
  const view = (over: Partial<DocPageView> = {}): DocPageView => ({
    slug: 'intro',
    name: 'Intro',
    pages: [0, 1],
    createdAt: '2026-07-13T00:00:00.000Z',
    ...over,
  })
  const isDimmed = (label: string): boolean =>
    screen.getByRole('group', { name: `page ${label}` }).className.includes('opacity-')

  it('dims non-member pages while a view is applied, and restores them when cleared', () => {
    const { rerender } = render(
      <ReaderView
        title="t"
        pdf={pdf()}
        reading={null}
        views={[view({ pages: [0, 1] })]}
        appliedView="intro"
        onRecordExposure={vi.fn()}
        onToggleFinished={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    expect(isDimmed('i')).toBe(false) // pageIndex 0 — a member
    expect(isDimmed('2')).toBe(true) // pageIndex 3 — not a member
    rerender(
      <ReaderView
        title="t"
        pdf={pdf()}
        reading={null}
        views={[view({ pages: [0, 1] })]}
        appliedView={null}
        onRecordExposure={vi.fn()}
        onToggleFinished={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    expect(isDimmed('2')).toBe(false) // cleared → all pages full-strength
  })

  it('the Views menu applies a saved view and clears it via callbacks', () => {
    const onApplyView = vi.fn()
    setup({ views: [view({ slug: 'intro', name: 'Intro', pages: [0, 1] })], onApplyView })
    fireEvent.click(screen.getByRole('button', { name: /^views/i }))
    fireEvent.click(screen.getByRole('button', { name: /apply Intro/i }))
    expect(onApplyView).toHaveBeenCalledWith('intro')
  })

  it('deletes a saved view via callback', () => {
    const onDeleteView = vi.fn()
    setup({ views: [view({ slug: 'intro', name: 'Intro' })], onDeleteView })
    fireEvent.click(screen.getByRole('button', { name: /^views/i }))
    fireEvent.click(screen.getByRole('button', { name: /delete Intro/i }))
    expect(onDeleteView).toHaveBeenCalledWith('intro')
  })

  it('saves the current TOC selection as a named view (pages + provenance paths)', async () => {
    const onSaveView = vi.fn()
    setup({ pdf: pdf({ getOutline: vi.fn().mockResolvedValue(OUTLINE) }), onSaveView })
    const box = await screen.findByRole('checkbox', { name: /select Methods/i })
    fireEvent.click(box) // Methods = /1, pages [3,4]
    fireEvent.click(screen.getByRole('button', { name: /^views/i }))
    fireEvent.change(screen.getByRole('textbox', { name: /new view name/i }), {
      target: { value: 'Just methods' },
    })
    fireEvent.click(screen.getByRole('button', { name: /save selection/i }))
    expect(onSaveView).toHaveBeenCalledWith('Just methods', [3, 4], ['/1'])
  })

  it('disables save while nothing is selected', () => {
    setup({ pdf: pdf({ getOutline: vi.fn().mockResolvedValue(OUTLINE) }) })
    fireEvent.click(screen.getByRole('button', { name: /^views/i }))
    expect(
      (screen.getByRole('button', { name: /save selection/i }) as HTMLButtonElement).disabled,
    ).toBe(true)
  })
})

describe('ReaderView minimap', () => {
  it('renders a right-edge minimap with a sliver per page', () => {
    setup()
    const strip = screen.getByRole('navigation', { name: /page minimap/i })
    expect(within(strip).getAllByRole('button')).toHaveLength(5)
  })

  it('offers a heat-source toggle only when there is heat to show', () => {
    const heat: PageAnnotations = {
      pages: [{ pageIndex: 2, count: 3, commented: 0, textChars: 0, commentChars: 0 }],
    }
    setup({ heat })
    expect(screen.getByRole('button', { name: /minimap annotations/i })).toBeTruthy()
    cleanup()
    setup() // no heat, no reading
    expect(screen.queryByRole('button', { name: /minimap annotations/i })).toBeNull()
  })
})
