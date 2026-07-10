// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { FilterBar } from './FilterBar'
import { emptySelection } from './selection'
import type { LensSelection } from './types'

afterEach(cleanup)

const handlers = () => ({
  onToggleScope: vi.fn(),
  onToggleKind: vi.fn(),
  onTogglePresence: vi.fn(),
  onRemoveTag: vi.fn(),
  onClearAll: vi.fn(),
})

function renderBar(selection: LensSelection, h = handlers(), names?: Map<number, string>) {
  render(<FilterBar selection={selection} collectionNames={names} {...h} />)
  return h
}

describe('FilterBar', () => {
  it('renders nothing when the selection is empty', () => {
    const { container } = render(<FilterBar selection={emptySelection()} {...handlers()} />)
    expect(container.firstChild).toBeNull()
  })

  it('shows a chip per active facet value', () => {
    renderBar({
      ...emptySelection(),
      sourceKeys: ['zotero'],
      kinds: ['pdf'],
      folderPrefixes: ['Projects/'],
      tags: [{ name: 'ml', mode: 'require' }],
    })
    expect(screen.getByText('zotero')).toBeTruthy()
    expect(screen.getByText('pdf')).toBeTruthy()
    expect(screen.getByText('Projects/')).toBeTruthy()
    expect(screen.getByText(/#ml/)).toBeTruthy()
  })

  it('removing a source chip toggles that scope value off', () => {
    const h = renderBar({ ...emptySelection(), sourceKeys: ['zotero'] })
    screen.getByRole('button', { name: /remove zotero/i }).click()
    expect(h.onToggleScope).toHaveBeenCalledWith('sourceKeys', 'zotero')
  })

  it('removing a kind chip toggles that kind off', () => {
    const h = renderBar({ ...emptySelection(), kinds: ['pdf'] })
    screen.getByRole('button', { name: /remove pdf/i }).click()
    expect(h.onToggleKind).toHaveBeenCalledWith('pdf')
  })

  it('removing a tag chip fires onRemoveTag', () => {
    const h = renderBar({ ...emptySelection(), tags: [{ name: 'ml', mode: 'exclude' }] })
    screen.getByRole('button', { name: /remove ml/i }).click()
    expect(h.onRemoveTag).toHaveBeenCalledWith('ml')
  })

  it('resolves a collection name from the lookup, falling back to the id', () => {
    renderBar(
      { ...emptySelection(), collectionIds: [5, 9] },
      handlers(),
      new Map([[5, 'Machine Learning']]),
    )
    expect(screen.getByText('Machine Learning')).toBeTruthy()
    expect(screen.getByText(/collection #9/)).toBeTruthy()
  })

  it('shows a presence chip with its human label', () => {
    renderBar({ ...emptySelection(), presence: ['both', 'eagle-only'] })
    expect(screen.getByText('In both')).toBeTruthy()
    expect(screen.getByText('Eagle only')).toBeTruthy()
  })

  it('removing a presence chip toggles that bucket off', () => {
    const h = renderBar({ ...emptySelection(), presence: ['zotero-only'] })
    screen.getByRole('button', { name: /remove zotero only/i }).click()
    expect(h.onTogglePresence).toHaveBeenCalledWith('zotero-only')
  })

  it('Clear all fires onClearAll', () => {
    const h = renderBar({ ...emptySelection(), kinds: ['pdf'] })
    screen.getByRole('button', { name: /clear all/i }).click()
    expect(h.onClearAll).toHaveBeenCalled()
  })

  it('shows a virtual-collection chip labelled via lookup, falling back to the slug', () => {
    render(
      <FilterBar
        selection={{ ...emptySelection(), virtualCollections: ['to-read', 'faves'] }}
        {...handlers()}
        vcollectionNames={new Map([['to-read', 'To Read']])}
      />,
    )
    expect(screen.getByText('To Read')).toBeTruthy()
    expect(screen.getByText('faves')).toBeTruthy()
  })

  it('removing a virtual-collection chip toggles that scope value off', () => {
    const h = handlers()
    render(
      <FilterBar selection={{ ...emptySelection(), virtualCollections: ['to-read'] }} {...h} />,
    )
    screen.getByRole('button', { name: /remove to-read/i }).click()
    expect(h.onToggleScope).toHaveBeenCalledWith('virtualCollections', 'to-read')
  })
})

describe('FilterBar — save view', () => {
  it('renders (for the save affordance) when the selection is empty but canSave is set', () => {
    const { container } = render(
      <FilterBar selection={emptySelection()} {...handlers()} canSave onSaveView={vi.fn()} />,
    )
    expect(container.firstChild).not.toBeNull()
    expect(screen.getByRole('button', { name: /save view/i })).toBeTruthy()
  })

  it('stays hidden when the selection is empty and canSave is unset', () => {
    const { container } = render(
      <FilterBar selection={emptySelection()} {...handlers()} onSaveView={vi.fn()} />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('reveals an inline name input (no native prompt) on click', () => {
    render(<FilterBar selection={{ ...emptySelection(), kinds: ['pdf'] }} {...handlers()} onSaveView={vi.fn()} />)
    expect(screen.queryByLabelText(/view name/i)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /save view/i }))
    expect(screen.getByLabelText(/view name/i)).toBeTruthy()
  })

  it('Enter fires onSaveView with the typed name', () => {
    const onSaveView = vi.fn()
    render(
      <FilterBar selection={{ ...emptySelection(), kinds: ['pdf'] }} {...handlers()} onSaveView={onSaveView} />,
    )
    fireEvent.click(screen.getByRole('button', { name: /save view/i }))
    const input = screen.getByLabelText(/view name/i) as HTMLInputElement
    fireEvent.change(input, { target: { value: 'Recent PDFs' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSaveView).toHaveBeenCalledWith('Recent PDFs')
  })

  it('does not fire onSaveView on Enter with a blank name', () => {
    const onSaveView = vi.fn()
    render(
      <FilterBar selection={{ ...emptySelection(), kinds: ['pdf'] }} {...handlers()} onSaveView={onSaveView} />,
    )
    fireEvent.click(screen.getByRole('button', { name: /save view/i }))
    const input = screen.getByLabelText(/view name/i)
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSaveView).not.toHaveBeenCalled()
  })

  it('shows no save affordance when onSaveView is not provided', () => {
    render(<FilterBar selection={{ ...emptySelection(), kinds: ['pdf'] }} {...handlers()} />)
    expect(screen.queryByRole('button', { name: /save view/i })).toBeNull()
  })
})
