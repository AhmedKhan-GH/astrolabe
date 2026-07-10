// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, within, waitFor } from '@testing-library/react'
import type { ExcalidrawScene } from './parse'

// Record the props the (mocked) Excalidraw component receives so we can assert on them.
// The real lib is heavy + DOM/canvas-bound; mocking it keeps the view fully testable in jsdom
// and proves the dynamic import path resolves to whatever we mount.
const excalidrawProps: Record<string, unknown>[] = []
vi.mock('@excalidraw/excalidraw', () => ({
  Excalidraw: (props: Record<string, unknown>) => {
    excalidrawProps.push(props)
    return <div data-testid="excalidraw-stub" />
  },
}))

import { ExcalidrawView } from './ExcalidrawView'

afterEach(() => {
  cleanup()
  excalidrawProps.length = 0
})

const scene: ExcalidrawScene = {
  elements: [{ id: 'a', type: 'rectangle' }, { id: 't', type: 'text', text: 'hi' }],
  appState: { viewBackgroundColor: '#faf0e6' },
  files: {},
}

const setup = (over: Partial<Parameters<typeof ExcalidrawView>[0]> = {}) => {
  const onOpenUri = vi.fn()
  const onOpenDetails = vi.fn()
  const onClose = vi.fn()
  render(
    <ExcalidrawView
      title="My Drawing"
      scene={scene}
      uri="obsidian://open?path=%2Fvault%2FMy%20Drawing.excalidraw.md"
      onOpenUri={onOpenUri}
      onOpenDetails={onOpenDetails}
      onClose={onClose}
      {...over}
    />,
  )
  return { onOpenUri, onOpenDetails, onClose }
}

describe('ExcalidrawView', () => {
  it('is a dialog labelled "drawing view" with the title', () => {
    setup()
    const dialog = screen.getByRole('dialog', { name: /drawing view/i })
    expect(within(dialog).getByText('My Drawing')).toBeTruthy()
  })

  it('mounts Excalidraw read-only (viewModeEnabled) with the scene elements', async () => {
    setup()
    await waitFor(() => expect(screen.getByTestId('excalidraw-stub')).toBeTruthy())
    const props = excalidrawProps.at(-1)!
    expect(props.viewModeEnabled).toBe(true)
    const initialData = props.initialData as { elements: unknown[]; appState: Record<string, unknown> }
    expect(initialData.elements).toHaveLength(2)
    // Scene background is honoured; the app forces dark theme regardless of the note.
    expect(initialData.appState.viewBackgroundColor).toBe('#faf0e6')
    expect(initialData.appState.theme).toBe('dark')
  })

  it('shows a loading hint before the drawing library resolves', () => {
    setup()
    expect(screen.getByText(/loading drawing/i)).toBeTruthy()
  })

  it('fires onOpenUri from the "open in Obsidian" button', () => {
    const { onOpenUri } = setup()
    fireEvent.click(screen.getByRole('button', { name: /open in obsidian/i }))
    expect(onOpenUri).toHaveBeenCalledWith(
      'obsidian://open?path=%2Fvault%2FMy%20Drawing.excalidraw.md',
    )
  })

  it('hides the Obsidian button when no uri is given', () => {
    setup({ uri: undefined })
    expect(screen.queryByRole('button', { name: /open in obsidian/i })).toBeNull()
  })

  it('closes via the × button and via Escape', () => {
    const { onClose } = setup()
    fireEvent.click(screen.getByRole('button', { name: /close drawing/i }))
    expect(onClose).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('fires onOpenDetails from the ⓘ button', () => {
    const { onOpenDetails } = setup()
    fireEvent.click(screen.getByRole('button', { name: /document details/i }))
    expect(onOpenDetails).toHaveBeenCalledTimes(1)
  })
})
