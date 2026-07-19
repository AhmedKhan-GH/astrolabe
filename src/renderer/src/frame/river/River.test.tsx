import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import type { ReactElement } from 'react'
import River from './River'
import { FrameProvider, useFrame, useFrameActions } from '../state'
import type { BrowseHit } from '../../../../main/index/queries'

// ── Fixtures ─────────────────────────────────────────────────────────────────

function hit(id: number, title: string, opts: { ghost?: boolean } = {}): BrowseHit {
  return {
    documentId: id,
    title,
    kind: 'pdf',
    modifiedAt: 0,
    tags: [],
    instances: opts.ghost
      ? []
      : [
          {
            instanceId: id * 10,
            connectorKey: 'zotero',
            libraryId: 1,
            libraryName: 'Main',
            libraryAvailability: 'live',
            uri: `zotero://${id}`,
            filePath: null,
            openPdfUri: null,
          },
        ],
  }
}

// ── window.astrolabe stub (the preload boundary IS the seam; no deeper mocking) ─

function stubAstrolabe(hits: BrowseHit[]): void {
  const api = {
    browse: vi.fn(async () => ({ total: hits.length, hits })),
    search: vi.fn(async ({ q }: { q: string }) => hits.filter((h) => h.title.includes(q))),
    open: vi.fn(async () => true),
    folders: {
      list: vi.fn(async () => [
        { slug: 'papers', name: 'Papers', ownCount: 0, subtreeCount: 0, children: [] },
      ]),
      addMembers: vi.fn(async () => []),
      removeMembers: vi.fn(async () => []),
    },
  }
  ;(window as unknown as { astrolabe: unknown }).astrolabe = api
}

function astro(): {
  browse: ReturnType<typeof vi.fn>
  folders: { addMembers: ReturnType<typeof vi.fn>; removeMembers: ReturnType<typeof vi.fn> }
} {
  return (window as unknown as { astrolabe: never }).astrolabe
}

// A probe so tests can read the frame's selectedDocumentId, plus a control to
// drive the rail into a folder selection.
function Probe(): ReactElement {
  const { selectedDocumentId } = useFrame()
  const actions = useFrameActions()
  return (
    <div>
      <div data-testid="selected">{String(selectedDocumentId)}</div>
      <button
        data-testid="go-folder"
        onClick={() => actions.selectRail({ kind: 'folder', slug: 'papers', includeSubfolders: false })}
      >
        go folder
      </button>
    </div>
  )
}

function mount(): void {
  render(
    <FrameProvider>
      <Probe />
      <River />
    </FrameProvider>,
  )
}

const row = (id: number): HTMLElement => screen.getByTestId(`river-row-${id}`)

beforeEach(() => {
  stubAstrolabe([hit(1, 'Alpha'), hit(2, 'Beta'), hit(3, 'Gamma')])
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('River', () => {
  it('renders hits from the stubbed browse', async () => {
    mount()
    expect(await screen.findByText('Alpha')).toBeInTheDocument()
    expect(screen.getByText('Beta')).toBeInTheDocument()
    expect(screen.getByText('Gamma')).toBeInTheDocument()
  })

  it('plain click selects the doc and opens detail', async () => {
    mount()
    await screen.findByText('Alpha')
    fireEvent.click(row(1))
    expect(screen.getByTestId('selected')).toHaveTextContent('1')
  })

  it('⌘-click builds a multi-select without changing detail', async () => {
    mount()
    await screen.findByText('Alpha')
    fireEvent.click(row(1)) // plain: selects doc 1, opens detail
    expect(screen.getByTestId('selected')).toHaveTextContent('1')
    fireEvent.click(row(2), { metaKey: true }) // ⌘: adds doc 2, detail untouched
    expect(screen.getByText('2 selected')).toBeInTheDocument()
    expect(screen.getByTestId('selected')).toHaveTextContent('1')
  })

  it('⇧-click range-selects from the last anchor', async () => {
    mount()
    await screen.findByText('Alpha')
    fireEvent.click(row(1)) // anchor at 1
    fireEvent.click(row(3), { shiftKey: true }) // range 1..3
    expect(screen.getByText('3 selected')).toBeInTheDocument()
  })

  it('the action bar shows the selection count', async () => {
    mount()
    await screen.findByText('Alpha')
    fireEvent.click(row(1), { metaKey: true })
    fireEvent.click(row(2), { metaKey: true })
    expect(screen.getByText('2 selected')).toBeInTheDocument()
  })

  it('File to folder calls addMembers with the selected ids and chosen slug', async () => {
    mount()
    await screen.findByText('Alpha')
    fireEvent.click(row(1))
    fireEvent.click(row(2), { metaKey: true })
    fireEvent.click(screen.getByText('File to folder…'))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByText('Papers'))
    await waitFor(() =>
      expect(astro().folders.addMembers).toHaveBeenCalledWith({
        slug: 'papers',
        documentIds: [1, 2],
      }),
    )
  })

  it('Remove from this folder shows only for a folder rail and calls removeMembers', async () => {
    mount()
    await screen.findByText('Alpha')

    // On the 'all' rail: no remove affordance even with a selection.
    fireEvent.click(row(1))
    expect(screen.queryByText('Remove from this folder')).not.toBeInTheDocument()

    // Switch the rail to a folder, re-select, then the button appears.
    fireEvent.click(screen.getByTestId('go-folder'))
    await screen.findByText('Alpha')
    fireEvent.click(row(1))
    fireEvent.click(row(2), { metaKey: true })
    fireEvent.click(screen.getByText('Remove from this folder'))
    await waitFor(() =>
      expect(astro().folders.removeMembers).toHaveBeenCalledWith({
        slug: 'papers',
        documentIds: [1, 2],
      }),
    )
  })

  it('renders a ghost row dimmed with a ghost chip', async () => {
    stubAstrolabe([hit(9, 'Phantom', { ghost: true })])
    mount()
    await screen.findByText('Phantom')
    expect(screen.getByText('ghost')).toBeInTheDocument()
    expect(row(9)).toHaveClass('opacity-50')
  })
})
