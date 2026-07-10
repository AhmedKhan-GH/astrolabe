// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { FilterBar } from './FilterBar'
import { emptySelection } from './selection'
import type { LensSelection } from './types'

afterEach(cleanup)

const handlers = () => ({
  onToggleScope: vi.fn(),
  onToggleKind: vi.fn(),
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

  it('Clear all fires onClearAll', () => {
    const h = renderBar({ ...emptySelection(), kinds: ['pdf'] })
    screen.getByRole('button', { name: /clear all/i }).click()
    expect(h.onClearAll).toHaveBeenCalled()
  })
})
