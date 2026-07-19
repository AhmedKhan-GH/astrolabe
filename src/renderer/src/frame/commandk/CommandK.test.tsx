import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CommandK } from './CommandK'
import { FrameProvider, useFrame } from '../state'
import type { FolderTreeNode, SearchHit } from '../../../../main/index/queries'
import type { LibrariesSnapshot } from '../../../../shared/db-ipc'

const tree: FolderTreeNode[] = [
  {
    slug: 'eec-174-aby',
    name: 'EEC 174 ABY',
    ownCount: 2,
    subtreeCount: 5,
    children: [{ slug: 'papers', name: 'Papers', ownCount: 3, subtreeCount: 3, children: [] }],
  },
  { slug: 'archive', name: 'Archive', ownCount: 1, subtreeCount: 1, children: [] },
]

const libraries: LibrariesSnapshot = {
  connectors: [{ key: 'zotero', status: 'ok' }],
  libraries: [
    {
      id: 9,
      connector: 'zotero',
      stableKey: 'z-1',
      displayName: 'My Zotero Library',
      availability: 'live',
      lastSeenAt: null,
      lastScanAt: null,
      documentCount: 12,
    },
  ],
}

const searchHits: SearchHit[] = [
  {
    documentId: 42,
    title: 'Attention Is All You Need',
    kind: 'pdf',
    snippet: '…transformer…',
    tags: [],
    instances: [],
  },
]

const search = vi.fn(async () => searchHits)

beforeEach(() => {
  search.mockClear()
  ;(window as unknown as { astrolabe: unknown }).astrolabe = {
    folders: { list: vi.fn(async () => tree) },
    libraries: vi.fn(async () => libraries),
    search,
  }
})
afterEach(cleanup)

/** Reads current selection into the DOM for assertions. */
function RailProbe(): React.JSX.Element {
  const { rail, selectedDocumentId } = useFrame()
  return (
    <>
      <div data-testid="rail">{JSON.stringify(rail)}</div>
      <div data-testid="doc">{String(selectedDocumentId)}</div>
    </>
  )
}

function renderPalette(onClose = vi.fn()): { onClose: ReturnType<typeof vi.fn> } {
  render(
    <FrameProvider>
      <CommandK open onClose={onClose} />
      <RailProbe />
    </FrameProvider>,
  )
  return { onClose }
}

const palette = (): HTMLElement => screen.getByRole('dialog')

describe('CommandK', () => {
  it('lists folders flattened with parent-path labels', async () => {
    renderPalette()
    expect(await screen.findByText('EEC 174 ABY / Papers')).toBeInTheDocument()
    expect(screen.getByText('EEC 174 ABY')).toBeInTheDocument()
    expect(screen.getByText('Archive')).toBeInTheDocument()
    // Empty query: libraries show, documents do not.
    expect(screen.getByText('My Zotero Library')).toBeInTheDocument()
    expect(screen.queryByText('Attention Is All You Need')).not.toBeInTheDocument()
  })

  it('filters folders by case-insensitive substring', async () => {
    const user = userEvent.setup()
    renderPalette()
    await screen.findByText('Archive')
    await user.type(screen.getByRole('textbox'), 'papers')
    expect(screen.getByText('EEC 174 ABY / Papers')).toBeInTheDocument()
    expect(screen.queryByText('Archive')).not.toBeInTheDocument()
  })

  it('surfaces stubbed search results after debounce for queries ≥2 chars', async () => {
    const user = userEvent.setup()
    renderPalette()
    await screen.findByText('Archive')
    await user.type(screen.getByRole('textbox'), 'at')
    expect(await screen.findByText('Attention Is All You Need')).toBeInTheDocument()
    expect(search).toHaveBeenCalledWith({ q: 'at', limit: 8 })
  })

  it('does not search for a single character', async () => {
    const user = userEvent.setup()
    renderPalette()
    await screen.findByText('Archive')
    await user.type(screen.getByRole('textbox'), 'a')
    // give any debounce a chance to (not) fire
    await new Promise((r) => setTimeout(r, 200))
    expect(search).not.toHaveBeenCalled()
  })

  it('dispatches a folder rail selection on Enter and closes', async () => {
    const user = userEvent.setup()
    const { onClose } = renderPalette()
    await screen.findByText('Archive')
    await user.type(screen.getByRole('textbox'), 'papers')
    await user.keyboard('{Enter}')
    expect(JSON.parse(screen.getByTestId('rail').textContent!)).toEqual({
      kind: 'folder',
      slug: 'papers',
      includeSubfolders: false,
    })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('moves the highlight across sections and opens a document on Enter', async () => {
    const user = userEvent.setup()
    renderPalette()
    await screen.findByText('Archive')
    // 'pa' matches the folder 'Papers' (path) AND surfaces the search doc, so
    // items = [folder, document]. ArrowDown steps off the folder onto the doc.
    await user.type(screen.getByRole('textbox'), 'pa')
    await screen.findByText('Attention Is All You Need')
    await user.keyboard('{ArrowDown}{Enter}')
    expect(screen.getByTestId('doc')).toHaveTextContent('42')
    expect(JSON.parse(screen.getByTestId('rail').textContent!)).toEqual({ kind: 'all' })
  })

  it('closes on Escape', async () => {
    const user = userEvent.setup()
    const { onClose } = renderPalette()
    await screen.findByText('Archive')
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('renders nothing when closed', () => {
    render(
      <FrameProvider>
        <CommandK open={false} onClose={vi.fn()} />
      </FrameProvider>,
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('defaults the highlight to the first folder row', async () => {
    renderPalette()
    const first = await screen.findByText('EEC 174 ABY')
    expect(within(palette()).getByRole('option', { selected: true })).toBe(
      first.closest('[role="option"]'),
    )
  })
})
