import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import Rail from './Rail'
import { installStub, renderInFrame, type Stub } from './test-utils'

/**
 * Rail behavior over the mocked preload seam (spec §8): sections + counts,
 * selection dispatch, expand/collapse, and each folder mutation gesture calling
 * the right window.astrolabe.folders.* with the right payload.
 */

let stub: Stub

beforeEach(() => {
  stub = installStub()
})
afterEach(cleanup)

describe('Rail', () => {
  it('renders the facet, folder, tag and library sections with counts', async () => {
    renderInFrame(<Rail />)
    await screen.findByText('Research')

    expect(screen.getByText('All')).toBeInTheDocument()
    expect(screen.getByText('42')).toBeInTheDocument() // stats.documents on All
    expect(screen.getByText('Uncategorized')).toBeInTheDocument()
    expect(screen.getByText('4')).toBeInTheDocument() // browse total for uncategorized
    expect(screen.getByText('Folders')).toBeInTheDocument()
    expect(screen.getByText('Smart Folders')).toBeInTheDocument()
    // folder counts: own beside name, subtree dimmed beside a parent
    expect(screen.getByText('Research')).toBeInTheDocument()
    expect(screen.getByText('5')).toBeInTheDocument() // Research subtree count
    // tags + libraries
    expect(screen.getByText('#paper')).toBeInTheDocument()
    expect(screen.getByText('Personal')).toBeInTheDocument()
    expect(screen.getByText('Eagle Lib')).toBeInTheDocument()
    expect(screen.getByText('zotero: ok')).toBeInTheDocument()
  })

  it('dispatches a folder selection to frame state on row click', async () => {
    renderInFrame(<Rail />)
    await screen.findByText('Research')

    fireEvent.click(screen.getByText('Research'))
    const probe = screen.getByTestId('rail-probe')
    expect(probe).toHaveTextContent('"kind":"folder"')
    expect(probe).toHaveTextContent('"slug":"research"')
    expect(probe).toHaveTextContent('"includeSubfolders":false')
  })

  it('dispatches a tag selection on tag click', async () => {
    renderInFrame(<Rail />)
    await screen.findByText('#paper')

    fireEvent.click(screen.getByText('#paper'))
    expect(screen.getByTestId('rail-probe')).toHaveTextContent('"kind":"tag","name":"paper"')
  })

  it('flips includeSubfolders via the selected folder toggle', async () => {
    renderInFrame(<Rail />)
    await screen.findByText('Research')

    fireEvent.click(screen.getByText('Research'))
    fireEvent.click(screen.getByLabelText('Toggle include subfolders'))
    expect(screen.getByTestId('rail-probe')).toHaveTextContent('"includeSubfolders":true')
  })

  it('expands and collapses a parent folder', async () => {
    renderInFrame(<Rail />)
    await screen.findByText('Research')

    expect(screen.queryByText('ML')).toBeNull()
    fireEvent.click(screen.getByLabelText('Expand Research'))
    expect(screen.getByText('ML')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Collapse Research'))
    expect(screen.queryByText('ML')).toBeNull()
  })

  it('creates a root folder with the typed name', async () => {
    renderInFrame(<Rail />)
    await screen.findByText('Research')

    fireEvent.click(screen.getByText('+ New Folder'))
    fireEvent.change(screen.getByLabelText('Folder name'), { target: { value: 'Papers' } })
    fireEvent.click(screen.getByText('Create'))

    await waitFor(() =>
      expect(stub.folders.create).toHaveBeenCalledWith({ name: 'Papers', parent: null }),
    )
  })

  it('confirms then deletes a folder (grouping only)', async () => {
    renderInFrame(<Rail />)
    await screen.findByText('Research')

    fireEvent.contextMenu(screen.getByText('Research'))
    fireEvent.click(screen.getByText('Delete')) // menu item
    expect(screen.getByText(/removes the grouping only/)).toBeInTheDocument()
    fireEvent.click(screen.getByText('Delete folder')) // confirm

    await waitFor(() => expect(stub.folders.remove).toHaveBeenCalledWith({ slug: 'research' }))
  })

  it('excludes the moving folder’s own subtree from the Move picker', async () => {
    renderInFrame(<Rail />)
    await screen.findByText('Research')

    fireEvent.contextMenu(screen.getByText('Research'))
    fireEvent.click(screen.getByText('Move to…'))
    // ML lives inside Research, so it must not be offered as a destination
    // (and the collapsed rail isn't showing it either).
    expect(screen.queryByText('ML')).toBeNull()
    fireEvent.click(screen.getByText('Top level'))
    fireEvent.click(screen.getByText('Move'))

    await waitFor(() =>
      expect(stub.folders.setParent).toHaveBeenCalledWith({ slug: 'research', parent: null }),
    )
  })

  it('imports from Eagle and renders the outcome counts', async () => {
    renderInFrame(<Rail />)
    await screen.findByText('Research')

    fireEvent.click(screen.getByText('Import from Eagle…'))
    expect(screen.getByText('Eagle Lib (12)')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Import'))

    await waitFor(() => expect(stub.folders.import).toHaveBeenCalledWith({ libraryId: 7 }))
    expect(await screen.findByText(/Created 2 folders/)).toBeInTheDocument()
  })

  it('offers a switch-&-sync affordance on a dormant Eagle library row', async () => {
    renderInFrame(<Rail />)
    // wait until the eagle known-libraries hook has resolved (faint rows appear)
    await screen.findByLabelText('Switch to Eagle Lib')

    fireEvent.click(screen.getByLabelText('Switch to Eagle Lib'))
    await waitFor(() => expect(stub.eagle.switch).toHaveBeenCalledWith('/eagle/lib'))
  })

  it('does not offer the switch affordance on a "gone" Eagle library row (review finding)', async () => {
    stub = installStub({
      libraries: vi.fn().mockResolvedValue({
        connectors: [{ key: 'eagle', status: 'ok' }],
        libraries: [
          {
            id: 9,
            connector: 'eagle',
            stableKey: '/eagle/ghost',
            displayName: 'Ghost Lib',
            availability: 'gone',
            lastSeenAt: null,
            lastScanAt: null,
            documentCount: 3,
          },
        ],
      }),
    })
    renderInFrame(<Rail />)
    await screen.findByText('Ghost Lib')

    expect(screen.queryByLabelText('Switch to Ghost Lib')).toBeNull()
  })

  it('shows known-but-unindexed Eagle libraries as faint rows with a first-scan switch', async () => {
    renderInFrame(<Rail />)
    await screen.findByLabelText('Switch to research')

    // research + stanford are in Eagle's history but not the index → faint rows.
    expect(screen.getByText('research')).toBeInTheDocument()
    expect(screen.getByText('stanford')).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('Switch to stanford'))
    await waitFor(() =>
      expect(stub.eagle.switch).toHaveBeenCalledWith('/eagle/stanford.library'),
    )
  })

  it('confirms then syncs all Eagle libraries and renders the summary', async () => {
    renderInFrame(<Rail />)
    await screen.findByText('Sync all Eagle libraries')

    fireEvent.click(screen.getByText('Sync all Eagle libraries'))
    expect(screen.getByText('Sync all Eagle libraries?')).toBeInTheDocument() // confirm step
    fireEvent.click(screen.getByText('Sync all')) // confirm button

    await waitFor(() => expect(stub.eagle.syncAll).toHaveBeenCalledOnce())
    expect(await screen.findByText(/Synced 2 of 3 libraries, 1 failed/)).toBeInTheDocument()
  })
})
