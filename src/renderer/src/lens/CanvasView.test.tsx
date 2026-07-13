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

// pageIndex 1: few annotations but COMMENTED (deep processing); pageIndex 3: many bare
// highlights. Breadth ranks 3 hotter; depth ranks 1 hotter — the mode toggle must flip them.
const heat: PageAnnotations = {
  pages: [
    { pageIndex: 1, count: 1, commented: 1, textChars: 50, commentChars: 30 },
    { pageIndex: 3, count: 5, commented: 0, textChars: 100, commentChars: 0 },
  ],
}

/** The amber tint overlay of a cell (carries its continuous intensity as data-heat). */
const overlayIntensity = (cell: HTMLElement): number | null => {
  const overlay = cell.querySelector('[data-heat]')
  return overlay ? Number(overlay.getAttribute('data-heat')) : null
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

  it('fires onOpenDetails from the ⓘ affordance when wired; hidden otherwise', () => {
    const onOpenDetails = vi.fn()
    setup({ onOpenDetails })
    fireEvent.click(screen.getByRole('button', { name: /document details/i }))
    expect(onOpenDetails).toHaveBeenCalledOnce()
    cleanup()
    setup()
    expect(screen.queryByRole('button', { name: /document details/i })).toBeNull()
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

  it('clicking a cell opens the in-canvas lightbox (does not jump straight out)', () => {
    const { onOpenPage } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'page 1' })) // 3rd page → index 2
    expect(screen.getByRole('dialog', { name: /page view/i })).toBeTruthy()
    expect(onOpenPage).not.toHaveBeenCalled()
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

  it('tints continuously, normalized to THIS document (hottest page = 1, others fractional)', () => {
    setup()
    const heavy = screen.getByRole('button', { name: 'page 2' }) // count 5 → breadth max
    const light = screen.getByRole('button', { name: 'page ii' }) // count 1
    const plain = screen.getByRole('button', { name: 'page i' })
    expect(overlayIntensity(heavy)).toBe(1)
    const lightIntensity = overlayIntensity(light)!
    expect(lightIntensity).toBeGreaterThan(0)
    expect(lightIntensity).toBeLessThan(1)
    expect(overlayIntensity(plain)).toBeNull()
  })

  it('depth mode re-ranks by substance: the commented page becomes the hottest', () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: 'depth' }))
    const commented = screen.getByRole('button', { name: 'page ii' })
    const bareHighlights = screen.getByRole('button', { name: 'page 2' })
    expect(overlayIntensity(commented)).toBe(1)
    expect(overlayIntensity(bareHighlights)!).toBeLessThan(1)
  })

  it('a read layer appears when reading-state exists and re-ranks by dwell', () => {
    // Dwell inverts the annotation ranking: page i (no annotations) was read longest.
    setup({
      reading: {
        contentSha256: 'h',
        pages: {
          '0': { dwellMs: 300_000, visits: 4, firstSeenAt: 'x', lastSeenAt: 'y' },
          '3': { dwellMs: 30_000, visits: 1, firstSeenAt: 'x', lastSeenAt: 'y' },
        },
        finished: false,
        finishedAt: null,
        updatedAt: 'y',
      },
    })
    fireEvent.click(screen.getByRole('button', { name: 'read' }))
    const mostRead = screen.getByRole('button', { name: 'page i' }) // pageIndex 0
    const skimmed = screen.getByRole('button', { name: 'page 2' }) // pageIndex 3
    expect(overlayIntensity(mostRead)).toBe(1)
    expect(overlayIntensity(skimmed)!).toBeLessThan(1)
    // Exposure is not an annotation count — no count badge in read mode.
    expect(within(mostRead).queryByText(/^\d+$/)).toBeNull()
  })

  it('offers no read layer without reading-state (null or empty)', () => {
    setup()
    expect(screen.queryByRole('button', { name: 'read' })).toBeNull()
    cleanup()
    setup({
      reading: { contentSha256: 'h', pages: {}, finished: false, finishedAt: null, updatedAt: 'y' },
    })
    expect(screen.queryByRole('button', { name: 'read' })).toBeNull()
  })

  it('fires onOpenReader from the header read affordance when wired; hidden otherwise', () => {
    const onOpenReader = vi.fn()
    setup({ onOpenReader })
    fireEvent.click(screen.getByRole('button', { name: 'open reader' }))
    expect(onOpenReader).toHaveBeenCalledOnce()
    cleanup()
    setup()
    expect(screen.queryByRole('button', { name: 'open reader' })).toBeNull()
  })

  it('count|depth mode buttons are exclusive and disappear with the heat layer off', () => {
    setup()
    const count = screen.getByRole('button', { name: 'count' })
    const depth = screen.getByRole('button', { name: 'depth' })
    expect(count.getAttribute('aria-pressed')).toBe('true')
    expect(depth.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(depth)
    expect(count.getAttribute('aria-pressed')).toBe('false')
    expect(depth.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'Annotations' })) // heat off
    expect(screen.queryByRole('button', { name: 'depth' })).toBeNull()
  })
})

describe('CanvasView grid zoom', () => {
  const gridColumns = (): string =>
    (document.querySelector('[data-testid="page-grid"]') as HTMLElement).style.gridTemplateColumns

  it('larger/smaller controls walk the cell-size ladder', () => {
    setup()
    expect(gridColumns()).toContain('140px')
    fireEvent.click(screen.getByRole('button', { name: /larger pages/i }))
    expect(gridColumns()).toContain('200px')
    fireEvent.click(screen.getByRole('button', { name: /smaller pages/i }))
    fireEvent.click(screen.getByRole('button', { name: /smaller pages/i }))
    expect(gridColumns()).toContain('100px')
  })

  it('the controls disable at the ladder ends', () => {
    setup()
    const smaller = screen.getByRole('button', { name: /smaller pages/i }) as HTMLButtonElement
    const larger = screen.getByRole('button', { name: /larger pages/i }) as HTMLButtonElement
    fireEvent.click(smaller) // 140 → 100 (bottom)
    expect(smaller.disabled).toBe(true)
    fireEvent.click(larger) // 100 → 140
    fireEvent.click(larger) // → 200
    fireEvent.click(larger) // → 280 (top)
    expect(larger.disabled).toBe(true)
  })
})

describe('CanvasView lightbox', () => {
  const openLightbox = (label = 'page i') => {
    fireEvent.click(screen.getByRole('button', { name: label }))
    return screen.getByRole('dialog', { name: /page view/i })
  }

  it('cell click opens a lightbox headed with the page label', () => {
    setup()
    const dialog = openLightbox('page ii') // pageIndex 1
    expect(within(dialog).getByText('page ii')).toBeTruthy()
  })

  it('arrow keys page through the lightbox (clamped at the ends)', () => {
    setup() // labels ['i','ii','1','2','3']
    const dialog = openLightbox('page i') // pageIndex 0
    expect(within(dialog).queryByText('page i')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'ArrowLeft' }) // clamped at 0
    expect(within(dialog).getByText('page i')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'ArrowRight' }) // → pageIndex 1
    expect(within(dialog).getByText('page ii')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'ArrowRight' }) // → pageIndex 2
    expect(within(dialog).getByText('page 1')).toBeTruthy()
  })

  it('chevron buttons navigate prev/next', () => {
    setup()
    const dialog = openLightbox('page ii') // pageIndex 1
    fireEvent.click(within(dialog).getByRole('button', { name: /next page/i }))
    expect(within(dialog).getByText('page 1')).toBeTruthy() // pageIndex 2
    fireEvent.click(within(dialog).getByRole('button', { name: /previous page/i }))
    expect(within(dialog).getByText('page ii')).toBeTruthy() // back to 1
  })

  it('Escape closes the lightbox first, leaving the canvas open', () => {
    const { onClose } = setup()
    openLightbox('page ii')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: /page view/i })).toBeNull()
    expect(onClose).not.toHaveBeenCalled()
    // a second Escape now closes the canvas
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('"open in source" fires onOpenPage with the current page index', () => {
    const { onOpenPage } = setup()
    const dialog = openLightbox('page ii') // pageIndex 1
    fireEvent.click(within(dialog).getByRole('button', { name: /next page/i })) // → pageIndex 2
    fireEvent.click(within(dialog).getByRole('button', { name: /open in source/i }))
    expect(onOpenPage).toHaveBeenCalledWith(2)
  })
})

describe('CanvasView lightbox zoom', () => {
  const openLightbox = () => {
    fireEvent.click(screen.getByRole('button', { name: 'page i' }))
    return screen.getByRole('dialog', { name: /page view/i })
  }
  const pageCanvas = (dialog: HTMLElement): HTMLCanvasElement =>
    dialog.querySelector('canvas') as HTMLCanvasElement

  it('opens fitted to the page (whole page visible — no more oversized fixed width)', () => {
    setup()
    const dialog = openLightbox()
    expect(within(dialog).getByRole('button', { name: /fit page/i }).getAttribute('aria-pressed')).toBe('true')
    expect(within(dialog).getByRole('button', { name: /fit width/i }).getAttribute('aria-pressed')).toBe('false')
  })

  it('zoom in leaves fit mode and sets an explicit larger width (measured base × 1.25)', () => {
    setup()
    const dialog = openLightbox()
    fireEvent.click(within(dialog).getByRole('button', { name: /zoom in/i }))
    expect(within(dialog).getByRole('button', { name: /fit page/i }).getAttribute('aria-pressed')).toBe('false')
    // jsdom has no layout → the container measures 0 and the 720px fallback base applies.
    expect(pageCanvas(dialog).style.width).toBe('900px')
  })

  it('zoom out from fit shrinks below the base width', () => {
    setup()
    const dialog = openLightbox()
    fireEvent.click(within(dialog).getByRole('button', { name: /zoom out/i }))
    expect(pageCanvas(dialog).style.width).toBe('576px')
  })

  it('keyboard: +/− zoom, w fits width, p fits page', () => {
    setup()
    const dialog = openLightbox()
    fireEvent.keyDown(document, { key: '+' })
    expect(pageCanvas(dialog).style.width).toBe('900px')
    fireEvent.keyDown(document, { key: 'w' })
    expect(within(dialog).getByRole('button', { name: /fit width/i }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.keyDown(document, { key: 'p' })
    expect(within(dialog).getByRole('button', { name: /fit page/i }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.keyDown(document, { key: '-' })
    expect(pageCanvas(dialog).style.width).toBe('576px')
  })

  it('re-rasterizes at the zoomed width so pixels stay sharp', () => {
    const renderThumb = vi.fn().mockResolvedValue(undefined)
    setup({ pdf: pdf({ renderThumb }) })
    const dialog = openLightbox()
    fireEvent.click(within(dialog).getByRole('button', { name: /zoom in/i }))
    const widths = renderThumb.mock.calls.map((c) => c[2])
    expect(widths.at(-1)).toBe(900)
  })
})
