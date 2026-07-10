// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, within, fireEvent } from '@testing-library/react'
import { NavRail } from './NavRail'
import { emptySelection } from './selection'
import type { NavData, LensSelection } from './types'

afterEach(cleanup)

const nav: NavData = {
  kinds: [
    { kind: 'pdf', count: 900 },
    { kind: 'image', count: 400 },
    { kind: 'note', count: 200 },
  ],
  sources: [
    {
      key: 'zotero',
      status: 'ok',
      documentCount: 900,
      tree: [
        {
          id: 1,
          name: 'Root',
          count: 10,
          children: [{ id: 2, name: 'Child', count: 4, children: [{ id: 3, name: 'Grand', count: 1, children: [] }] }],
        },
      ],
    },
    {
      key: 'obsidian',
      status: 'ok',
      documentCount: 200,
      tree: [{ id: 'Projects/', name: 'Projects', count: 12, children: [] }],
    },
    { key: 'eagle', status: 'ok', documentCount: 400, tree: [] },
  ],
  tags: [
    { name: 'ml', count: 50 },
    { name: 'physics', count: 30 },
    { name: 'biology', count: 10 },
  ],
}

const handlers = () => ({
  onToggleKind: vi.fn(),
  onToggleScope: vi.fn(),
  onCycleTag: vi.fn(),
  onSetTagMatch: vi.fn(),
})

function renderRail(selection: LensSelection = emptySelection(), h = handlers()) {
  render(<NavRail nav={nav} selection={selection} {...h} />)
  return h
}

describe('NavRail — kinds', () => {
  it('renders kind chips with counts and fires onToggleKind on click', () => {
    const h = renderRail()
    const chip = screen.getByRole('button', { name: /pdf/i })
    expect(within(chip).getByText('900')).toBeTruthy()
    chip.click()
    expect(h.onToggleKind).toHaveBeenCalledWith('pdf')
  })

  it('highlights every selected kind (multi-select)', () => {
    renderRail({ ...emptySelection(), kinds: ['pdf', 'image'] })
    expect(screen.getByRole('button', { name: /pdf/i }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: /image/i }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: /note/i }).getAttribute('aria-pressed')).toBe('false')
  })
})

describe('NavRail — sources & tree (no cross-dimension clearing)', () => {
  it('source header fires onToggleScope(sourceKeys, key)', () => {
    const h = renderRail()
    screen.getByRole('button', { name: /^zotero/i }).click()
    expect(h.onToggleScope).toHaveBeenCalledWith('sourceKeys', 'zotero')
  })

  it('highlights each selected source independently', () => {
    renderRail({ ...emptySelection(), sourceKeys: ['zotero', 'eagle'] })
    expect(screen.getByRole('button', { name: /^zotero/i }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: /^eagle/i }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: /^obsidian/i }).getAttribute('aria-pressed')).toBe('false')
  })

  it('collection node fires onToggleScope(collectionIds, id)', () => {
    const h = renderRail()
    screen.getByRole('button', { name: /^Root/ }).click()
    expect(h.onToggleScope).toHaveBeenCalledWith('collectionIds', 1)
  })

  it('obsidian folder node fires onToggleScope(folderPrefixes, path)', () => {
    const h = renderRail()
    screen.getByRole('button', { name: /Projects/ }).click()
    expect(h.onToggleScope).toHaveBeenCalledWith('folderPrefixes', 'Projects/')
  })

  it('highlights a selected collection node', () => {
    renderRail({ ...emptySelection(), collectionIds: [1] })
    expect(screen.getByRole('button', { name: /^Root/ }).getAttribute('aria-pressed')).toBe('true')
  })
})

describe('NavRail — tags (tri-state)', () => {
  it('fires onCycleTag on click', () => {
    const h = renderRail()
    screen.getByRole('button', { name: /#ml/ }).click()
    expect(h.onCycleTag).toHaveBeenCalledWith('ml')
  })

  it('renders each tag with its mode (neutral / require / exclude)', () => {
    renderRail({
      ...emptySelection(),
      tags: [
        { name: 'ml', mode: 'require' },
        { name: 'physics', mode: 'exclude' },
      ],
    })
    expect(screen.getByRole('button', { name: /#ml/ }).getAttribute('data-mode')).toBe('require')
    expect(screen.getByRole('button', { name: /#physics/ }).getAttribute('data-mode')).toBe('exclude')
    expect(screen.getByRole('button', { name: /#biology/ }).getAttribute('data-mode')).toBe('neutral')
  })

  it('filter input narrows the tag list', () => {
    render(<NavRail nav={nav} selection={emptySelection()} {...handlers()} />)
    const input = screen.getByPlaceholderText(/filter tags/i) as HTMLInputElement
    fireEvent.change(input, { target: { value: 'phys' } })
    expect(screen.queryByRole('button', { name: /#physics/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /#ml/ })).toBeNull()
  })
})

describe('NavRail — tag match control', () => {
  const withRequired = (...names: string[]): LensSelection => ({
    ...emptySelection(),
    tags: names.map((name) => ({ name, mode: 'require' as const })),
  })

  it('is hidden with fewer than two required tags', () => {
    renderRail(withRequired('ml'))
    expect(screen.queryByLabelText(/tag match/i)).toBeNull()
  })

  it('appears once two or more tags are required', () => {
    renderRail(withRequired('ml', 'physics'))
    expect(screen.getByLabelText(/tag match/i)).toBeTruthy()
  })

  it('toggling the control fires onSetTagMatch with the other mode', () => {
    const h = renderRail(withRequired('ml', 'physics')) // default tagMatch 'all'
    screen.getByLabelText(/tag match/i).click()
    expect(h.onSetTagMatch).toHaveBeenCalledWith('any')
  })
})
