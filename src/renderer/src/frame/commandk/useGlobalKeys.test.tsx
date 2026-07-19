import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useGlobalKeys } from './useGlobalKeys'
import { FrameProvider, useFrame, useFrameActions } from '../state'

afterEach(cleanup)

/** Wires the hook, exposes rail state, and offers a button that navigates so
 *  history has something to go back to. */
function Harness({ onOpenPalette }: { onOpenPalette: () => void }): React.JSX.Element {
  useGlobalKeys({ onOpenPalette })
  const { rail } = useFrame()
  const actions = useFrameActions()
  return (
    <div>
      <input data-testid="field" />
      <button onClick={() => actions.selectRail({ kind: 'library', id: 7 })}>nav</button>
      <div data-testid="rail">{JSON.stringify(rail)}</div>
    </div>
  )
}

function renderHarness(onOpenPalette = vi.fn()): { onOpenPalette: ReturnType<typeof vi.fn> } {
  render(
    <FrameProvider>
      <Harness onOpenPalette={onOpenPalette} />
    </FrameProvider>,
  )
  return { onOpenPalette }
}

const rail = (): unknown => JSON.parse(screen.getByTestId('rail').textContent!)

describe('useGlobalKeys', () => {
  it('⌘K opens the palette', () => {
    const { onOpenPalette } = renderHarness()
    fireEvent.keyDown(window, { key: 'k', metaKey: true })
    expect(onOpenPalette).toHaveBeenCalledTimes(1)
  })

  it('ctrl+K opens the palette too', () => {
    const { onOpenPalette } = renderHarness()
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    expect(onOpenPalette).toHaveBeenCalledTimes(1)
  })

  it('⌘[ steps history back after a navigation', async () => {
    const user = userEvent.setup()
    renderHarness()
    await user.click(screen.getByText('nav'))
    expect(rail()).toEqual({ kind: 'library', id: 7 })
    fireEvent.keyDown(window, { key: '[', metaKey: true })
    expect(rail()).toEqual({ kind: 'all' })
  })

  it('⌘] steps history forward after going back', async () => {
    const user = userEvent.setup()
    renderHarness()
    await user.click(screen.getByText('nav'))
    fireEvent.keyDown(window, { key: '[', metaKey: true })
    expect(rail()).toEqual({ kind: 'all' })
    fireEvent.keyDown(window, { key: ']', metaKey: true })
    expect(rail()).toEqual({ kind: 'library', id: 7 })
  })

  it('⌘F focuses and selects the river search field', () => {
    const search = document.createElement('input')
    search.id = 'frame-search'
    search.value = 'hello'
    document.body.appendChild(search)
    renderHarness()
    fireEvent.keyDown(window, { key: 'f', metaKey: true })
    expect(document.activeElement).toBe(search)
    search.remove()
  })

  it('plain typing into a field triggers nothing', async () => {
    const user = userEvent.setup()
    const { onOpenPalette } = renderHarness()
    await user.click(screen.getByTestId('field'))
    await user.keyboard('kfhello')
    expect(onOpenPalette).not.toHaveBeenCalled()
    expect(rail()).toEqual({ kind: 'all' })
  })

  it('removes its listener on unmount', () => {
    const onOpenPalette = vi.fn()
    const { unmount } = render(
      <FrameProvider>
        <Harness onOpenPalette={onOpenPalette} />
      </FrameProvider>,
    )
    unmount()
    fireEvent.keyDown(window, { key: 'k', metaKey: true })
    expect(onOpenPalette).not.toHaveBeenCalled()
  })
})
