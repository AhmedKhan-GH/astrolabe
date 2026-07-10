// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { DocumentRow, DocumentRiver } from './DocumentRiver'
import { shouldFetchNextPage } from './pagination'
import type { BrowseHit, BrowsePage, VCollectionSummary } from './types'

afterEach(cleanup)

const hit = (over: Partial<BrowseHit> = {}): BrowseHit => ({
  documentId: 1,
  title: 'Probabilistic Machine Learning',
  kind: 'pdf',
  modifiedAt: Date.now(),
  tags: ['ml', 'textbook'],
  virtualCollections: [],
  instances: [
    { sourceKey: 'zotero', uri: 'zotero://select/items/ABC', filePath: '/tmp/x.pdf' },
    { sourceKey: 'eagle', uri: 'eagle://item/XYZ', filePath: null },
  ],
  ...over,
})

const collections: VCollectionSummary[] = [
  { slug: 'to-read', name: 'To Read', count: 12, unresolvedCount: 0 },
  { slug: 'faves', name: 'Faves', count: 3, unresolvedCount: 0 },
]

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

  it('shows no membership affordance when the feature is not wired', () => {
    render(<DocumentRow hit={hit()} onOpenUri={vi.fn()} onOpenFile={vi.fn()} onReveal={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /add to collection/i })).toBeNull()
  })
})

describe('DocumentRow — membership popover', () => {
  const rowProps = (over = {}) => ({
    onOpenUri: vi.fn(),
    onOpenFile: vi.fn(),
    onReveal: vi.fn(),
    onToggleMembership: vi.fn(),
    onCreateAndAdd: vi.fn(),
    ...over,
  })

  it('opens a popover with a checkbox per collection on ＋ click', () => {
    render(<DocumentRow hit={hit()} collections={collections} {...rowProps()} />)
    expect(screen.queryByRole('dialog', { name: /collections/i })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /add to collection/i }))
    const dialog = screen.getByRole('dialog', { name: /collections/i })
    expect(within(dialog).getByRole('checkbox', { name: /to read/i })).toBeTruthy()
    expect(within(dialog).getByRole('checkbox', { name: /faves/i })).toBeTruthy()
  })

  it('reflects current membership in the checkbox checked state', () => {
    render(
      <DocumentRow hit={hit({ virtualCollections: ['faves'] })} collections={collections} {...rowProps()} />,
    )
    fireEvent.click(screen.getByRole('button', { name: /add to collection/i }))
    expect((screen.getByRole('checkbox', { name: /faves/i }) as HTMLInputElement).checked).toBe(true)
    expect((screen.getByRole('checkbox', { name: /to read/i }) as HTMLInputElement).checked).toBe(false)
  })

  it('checking an unchecked collection fires onToggleMembership(id, slug, true)', () => {
    const onToggleMembership = vi.fn()
    render(
      <DocumentRow
        hit={hit({ documentId: 42 })}
        collections={collections}
        {...rowProps({ onToggleMembership })}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /add to collection/i }))
    fireEvent.click(screen.getByRole('checkbox', { name: /to read/i }))
    expect(onToggleMembership).toHaveBeenCalledWith(42, 'to-read', true)
  })

  it('unchecking a member collection fires onToggleMembership(id, slug, false)', () => {
    const onToggleMembership = vi.fn()
    render(
      <DocumentRow
        hit={hit({ documentId: 42, virtualCollections: ['faves'] })}
        collections={collections}
        {...rowProps({ onToggleMembership })}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /add to collection/i }))
    fireEvent.click(screen.getByRole('checkbox', { name: /faves/i }))
    expect(onToggleMembership).toHaveBeenCalledWith(42, 'faves', false)
  })

  it('the footer input fires onCreateAndAdd(id, name) on Enter', () => {
    const onCreateAndAdd = vi.fn()
    render(
      <DocumentRow
        hit={hit({ documentId: 7 })}
        collections={collections}
        {...rowProps({ onCreateAndAdd })}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /add to collection/i }))
    const input = screen.getByLabelText(/new collection name/i)
    fireEvent.change(input, { target: { value: 'Later' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onCreateAndAdd).toHaveBeenCalledWith(7, 'Later')
  })

  it('closes on Escape', () => {
    render(<DocumentRow hit={hit()} collections={collections} {...rowProps()} />)
    fireEvent.click(screen.getByRole('button', { name: /add to collection/i }))
    expect(screen.getByRole('dialog', { name: /collections/i })).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: /collections/i })).toBeNull()
  })

  it('closes on an outside click', () => {
    render(<DocumentRow hit={hit()} collections={collections} {...rowProps()} />)
    fireEvent.click(screen.getByRole('button', { name: /add to collection/i }))
    expect(screen.getByRole('dialog', { name: /collections/i })).toBeTruthy()
    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('dialog', { name: /collections/i })).toBeNull()
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
