import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { DocumentDetail } from '../../../../main/index/queries'
import { FrameProvider, useFrame, useFrameActions } from '../state'
import DetailPanel from './DetailPanel'

/**
 * Behavior over the preload boundary (spec §8): a mocked `window.astrolabe`
 * feeds a fixture DocumentDetail; a Probe drives selection and mirrors the
 * frame state back out so navigation dispatches are observable.
 */

const RICH: DocumentDetail = {
  documentId: 1,
  title: 'The Structure of Scientific Revolutions',
  kind: 'pdf',
  modifiedAt: 1_700_000_000_000,
  tags: ['philosophy', 'history', 'science'],
  instances: [
    {
      instanceId: 11,
      connectorKey: 'zotero',
      libraryId: 1,
      libraryName: 'Personal',
      libraryAvailability: 'live',
      uri: 'zotero://select/library/items/AAA',
      filePath: '/vault/kuhn.pdf',
      openPdfUri: 'zotero://open-pdf/library/items/AAA',
    },
    {
      instanceId: 12,
      connectorKey: 'zotero',
      libraryId: 2,
      libraryName: 'Group Beta',
      libraryAvailability: 'dormant',
      uri: 'zotero://select/groups/2/items/BBB',
      filePath: null,
      openPdfUri: null,
    },
  ],
  folders: [
    { slug: 'phil-sci', name: 'Philosophy of Science' },
    { slug: 'to-read', name: 'To Read' },
  ],
  annotations: {
    total: 7,
    preview: [
      { text: 'Paradigm shift', comment: 'core idea', pageLabel: '10' },
      { text: 'Normal science', comment: null, pageLabel: '23' },
      { text: null, comment: 'my note', pageLabel: '40' },
      { text: 'Anomaly', comment: null, pageLabel: '55' },
      { text: 'Crisis', comment: 'compare Popper', pageLabel: '72' },
    ],
  },
  backlinks: [
    { documentId: 2, title: 'Reading notes — Kuhn', kind: 'note', instanceId: 21 },
    { documentId: 3, title: 'Seminar outline', kind: 'note', instanceId: 22 },
  ],
}

const GHOST: DocumentDetail = {
  ...RICH,
  documentId: 9,
  title: 'A Forgotten Paper',
  instances: [],
}

const openMock = vi.fn(() => Promise.resolve(true))
let documentImpl: (id: number) => Promise<DocumentDetail | null> = () => Promise.resolve(RICH)

function stubAstrolabe(): void {
  const api = {
    document: (id: number) => documentImpl(id),
    open: openMock,
  }
  window.astrolabe = api as unknown as Window['astrolabe']
}

function Probe(): React.JSX.Element {
  const { rail, selectedDocumentId } = useFrame()
  const actions = useFrameActions()
  return (
    <div>
      <button onClick={() => actions.selectDocument(1)}>drive-open</button>
      <div data-testid="rail">{JSON.stringify(rail)}</div>
      <div data-testid="selected">{String(selectedDocumentId)}</div>
    </div>
  )
}

function renderPanel(): void {
  render(
    <FrameProvider>
      <Probe />
      <DetailPanel />
    </FrameProvider>,
  )
}

beforeEach(() => {
  openMock.mockClear()
  documentImpl = () => Promise.resolve(RICH)
  stubAstrolabe()
})

afterEach(() => {
  cleanup()
})

describe('DetailPanel', () => {
  it('is hidden while the detail is closed, and opens on selection', async () => {
    renderPanel()
    expect(screen.queryByText(RICH.title)).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('drive-open'))
    expect(await screen.findByText(RICH.title)).toBeInTheDocument()
  })

  it('renders every section from a rich fixture', async () => {
    renderPanel()
    fireEvent.click(screen.getByText('drive-open'))

    // Header
    expect(await screen.findByText(RICH.title)).toBeInTheDocument()
    expect(screen.getByText('pdf')).toBeInTheDocument()

    // Instances — both libraries, distinct badges
    expect(screen.getByText('zotero:Personal')).toBeInTheDocument()
    expect(screen.getByText('zotero:Group Beta')).toBeInTheDocument()

    // Folders
    expect(screen.getByRole('button', { name: 'Philosophy of Science' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'To Read' })).toBeInTheDocument()

    // Tags (all three)
    expect(screen.getByRole('button', { name: 'philosophy' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'history' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'science' })).toBeInTheDocument()

    // Annotations — count + 5 previews
    expect(screen.getByText('7 annotations')).toBeInTheDocument()
    expect(screen.getByText('Paradigm shift')).toBeInTheDocument()
    expect(screen.getByText('Crisis')).toBeInTheDocument()
    expect(screen.getByText('my note')).toBeInTheDocument()

    // Backlinks
    expect(screen.getByText('Linked from')).toBeInTheDocument()
    expect(screen.getByText('Reading notes — Kuhn')).toBeInTheDocument()
    expect(screen.getByText('Seminar outline')).toBeInTheDocument()

    // No ghost banner when copies exist
    expect(screen.queryByText(/No live copies/)).not.toBeInTheDocument()
  })

  it('shows the ghost banner when a document has zero instances', async () => {
    documentImpl = () => Promise.resolve(GHOST)
    renderPanel()
    fireEvent.click(screen.getByText('drive-open'))

    expect(await screen.findByText(/No live copies — this document is remembered/)).toBeInTheDocument()
  })

  it('navigates the rail to a folder when a folder chip is clicked', async () => {
    renderPanel()
    fireEvent.click(screen.getByText('drive-open'))

    fireEvent.click(await screen.findByRole('button', { name: 'Philosophy of Science' }))
    const rail = JSON.parse(screen.getByTestId('rail').textContent ?? '{}')
    expect(rail).toEqual({ kind: 'folder', slug: 'phil-sci', includeSubfolders: false })
  })

  it('re-selects the source document when a backlink is clicked', async () => {
    renderPanel()
    fireEvent.click(screen.getByText('drive-open'))

    fireEvent.click(await screen.findByText('Reading notes — Kuhn'))
    expect(screen.getByTestId('selected')).toHaveTextContent('2')
  })

  it('opens the openPdfUri when present, else the uri', async () => {
    renderPanel()
    fireEvent.click(screen.getByText('drive-open'))
    await screen.findByText(RICH.title)

    const openButtons = screen.getAllByRole('button', { name: 'Open' })
    expect(openButtons).toHaveLength(2)

    fireEvent.click(openButtons[0])
    expect(openMock).toHaveBeenLastCalledWith({ kind: 'uri', value: RICH.instances[0].openPdfUri })

    fireEvent.click(openButtons[1])
    expect(openMock).toHaveBeenLastCalledWith({ kind: 'uri', value: RICH.instances[1].uri })
  })

  it('reveals a filePath when present', async () => {
    renderPanel()
    fireEvent.click(screen.getByText('drive-open'))
    await screen.findByText(RICH.title)

    const revealButtons = screen.getAllByRole('button', { name: 'Reveal' })
    // Only the first instance carries a filePath.
    expect(revealButtons).toHaveLength(1)
    fireEvent.click(revealButtons[0])
    expect(openMock).toHaveBeenLastCalledWith({ kind: 'reveal', value: '/vault/kuhn.pdf' })
  })
})
