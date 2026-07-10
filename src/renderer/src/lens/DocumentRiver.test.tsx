// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { DocumentRow, DocumentRiver } from './DocumentRiver'
import { shouldFetchNextPage } from './pagination'
import type { BrowseHit, BrowsePage } from './types'

afterEach(cleanup)

const hit = (over: Partial<BrowseHit> = {}): BrowseHit => ({
  documentId: 1,
  title: 'Probabilistic Machine Learning',
  kind: 'pdf',
  modifiedAt: Date.now(),
  tags: ['ml', 'textbook'],
  instances: [
    { sourceKey: 'zotero', uri: 'zotero://select/items/ABC', filePath: '/tmp/x.pdf' },
    { sourceKey: 'eagle', uri: 'eagle://item/XYZ', filePath: null },
  ],
  ...over,
})

describe('DocumentRow', () => {
  it('renders title, kind and both source jump-outs', () => {
    render(<DocumentRow hit={hit()} onOpenUri={vi.fn()} onOpenFile={vi.fn()} onReveal={vi.fn()} />)
    expect(screen.getByText('Probabilistic Machine Learning')).toBeTruthy()
    expect(screen.getByText('zotero ↗')).toBeTruthy()
    expect(screen.getByText('eagle ↗')).toBeTruthy()
  })

  it('jump-out dispatches the instance URI', () => {
    const onOpenUri = vi.fn()
    render(<DocumentRow hit={hit()} onOpenUri={onOpenUri} onOpenFile={vi.fn()} onReveal={vi.fn()} />)
    screen.getByText('zotero ↗').click()
    expect(onOpenUri).toHaveBeenCalledWith('zotero://select/items/ABC')
  })

  it('caps tag chips at 6', () => {
    const tags = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
    render(<DocumentRow hit={hit({ tags })} onOpenUri={vi.fn()} onOpenFile={vi.fn()} onReveal={vi.fn()} />)
    expect(screen.getAllByText(/^#/).length).toBe(6)
  })
})

function wrap(page: BrowsePage) {
  const browse = vi.fn().mockResolvedValue(page)
  // @ts-expect-error minimal window seam for the query — real preload lands at integration.
  window.astrolabe = { index: { browse }, system: {} }
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <DocumentRiver filters={{}} />
    </QueryClientProvider>,
  )
  return browse
}

describe('DocumentRiver container', () => {
  beforeEach(() => {
    // jsdom has no layout; make the virtualizer measurable-enough not to crash.
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, value: 600 })
  })

  it('empty index → "index is empty" branch', async () => {
    wrap({ total: 0, hits: [] })
    expect(await screen.findByText(/index is empty/i)).toBeTruthy()
  })

  it('non-empty → "N documents" readout', async () => {
    wrap({ total: 3, hits: [hit(), hit({ documentId: 2 }), hit({ documentId: 3 })] })
    expect(await screen.findByText(/3 documents/i)).toBeTruthy()
  })
})

describe('shouldFetchNextPage', () => {
  it('prefetches when the visible range approaches the loaded boundary', () => {
    expect(
      shouldFetchNextPage({
        lastVisibleIndex: 90,
        loadedCount: 100,
        hasNextPage: true,
        isFetchingNextPage: false,
      }),
    ).toBe(true)
  })

  it('does not duplicate a request or fetch past the final page', () => {
    expect(
      shouldFetchNextPage({
        lastVisibleIndex: 99,
        loadedCount: 100,
        hasNextPage: true,
        isFetchingNextPage: true,
      }),
    ).toBe(false)
    expect(
      shouldFetchNextPage({
        lastVisibleIndex: 99,
        loadedCount: 100,
        hasNextPage: false,
        isFetchingNextPage: false,
      }),
    ).toBe(false)
  })
})
