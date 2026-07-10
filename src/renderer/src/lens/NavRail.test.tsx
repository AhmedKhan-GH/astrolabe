// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, within, fireEvent } from '@testing-library/react'
import { NavRail } from './NavRail'
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

function renderRail(selection: LensSelection = {}, onSelect = vi.fn()) {
  render(<NavRail nav={nav} selection={selection} onSelect={onSelect} />)
  return onSelect
}

describe('NavRail — kinds', () => {
  it('renders kind chips with counts and fires onSelect({kind}) on click', () => {
    const onSelect = renderRail()
    const chip = screen.getByRole('button', { name: /pdf/i })
    expect(within(chip).getByText('900')).toBeTruthy()
    chip.click()
    expect(onSelect).toHaveBeenCalledWith({ kind: 'pdf' })
  })

  it('marks the selected kind as pressed', () => {
    renderRail({ kind: 'image' })
    expect((screen.getByRole('button', { name: /image/i }) as HTMLButtonElement).getAttribute('aria-pressed')).toBe('true')
    expect((screen.getByRole('button', { name: /pdf/i }) as HTMLButtonElement).getAttribute('aria-pressed')).toBe('false')
  })
})

describe('NavRail — sources', () => {
  it('source header fires onSelect({sourceKey})', () => {
    const onSelect = renderRail()
    screen.getByRole('button', { name: /^zotero/i }).click()
    expect(onSelect).toHaveBeenCalledWith({ sourceKey: 'zotero' })
  })

  it('marks the selected source header as pressed', () => {
    renderRail({ sourceKey: 'eagle' })
    expect(screen.getByRole('button', { name: /^eagle/i }).getAttribute('aria-pressed')).toBe('true')
  })
})

describe('NavRail — collection tree', () => {
  it('renders a zotero collection node and fires onSelect({collectionId})', () => {
    const onSelect = renderRail()
    screen.getByRole('button', { name: /^Root/ }).click()
    expect(onSelect).toHaveBeenCalledWith({ collectionId: 1 })
  })

  it('roots expanded, deeper levels collapsed by default', () => {
    renderRail()
    expect(screen.queryByRole('button', { name: /^Child/ })).toBeTruthy() // root expanded
    expect(screen.queryByRole('button', { name: /^Grand/ })).toBeNull() // child collapsed
  })

  it('clicking a chevron expands the next level', () => {
    renderRail()
    fireEvent.click(screen.getByRole('button', { name: /expand Child/i }))
    expect(screen.queryByRole('button', { name: /^Grand/ })).toBeTruthy()
  })

  it('obsidian folder node fires onSelect({folderPrefix})', () => {
    const onSelect = renderRail()
    screen.getByRole('button', { name: /Projects/ }).click()
    expect(onSelect).toHaveBeenCalledWith({ folderPrefix: 'Projects/' })
  })

  it('marks a selected collection node as pressed', () => {
    renderRail({ collectionId: 1 })
    expect(screen.getByRole('button', { name: /^Root/ }).getAttribute('aria-pressed')).toBe('true')
  })
})

describe('NavRail — tags', () => {
  it('fires onSelect({tag}) on click', () => {
    const onSelect = renderRail()
    screen.getByRole('button', { name: /#ml/ }).click()
    expect(onSelect).toHaveBeenCalledWith({ tag: 'ml' })
  })

  it('filter input narrows the tag list', () => {
    const { getByPlaceholderText } = render(<NavRail nav={nav} selection={{}} onSelect={vi.fn()} />)
    const input = getByPlaceholderText(/filter tags/i) as HTMLInputElement
    fireEvent.change(input, { target: { value: 'phys' } })
    expect(screen.queryByRole('button', { name: /#physics/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /#ml/ })).toBeNull()
  })
})
