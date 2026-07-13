// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { TocSidebar } from './TocSidebar'
import { flattenOutline, tocPageRanges, type OutlineEntry } from './toc'

afterEach(cleanup)

const outline: OutlineEntry[] = [
  {
    title: 'A',
    pageIndex: 0,
    children: [
      { title: 'A.1', pageIndex: 2, children: [] },
      {
        title: 'A.2',
        pageIndex: 4,
        children: [{ title: 'A.2.a', pageIndex: 5, children: [] }],
      },
    ],
  },
  { title: 'B', pageIndex: 8, children: [] },
]
const ranges = tocPageRanges(flattenOutline(outline), 10)

const setup = (over: Partial<Parameters<typeof TocSidebar>[0]> = {}) => {
  const onToggleSelect = vi.fn()
  const onNavigate = vi.fn()
  render(
    <TocSidebar
      outline={outline}
      ranges={ranges}
      currentPath={null}
      selected={new Set()}
      onToggleSelect={onToggleSelect}
      onNavigate={onNavigate}
      {...over}
    />,
  )
  return { onToggleSelect, onNavigate }
}

describe('TocSidebar tree', () => {
  it('renders top + second-level nodes; deeper nodes are collapsed by default', () => {
    setup()
    expect(screen.getByRole('button', { name: 'A' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'B' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'A.1' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'A.2' })).toBeTruthy()
    // A.2.a is depth 3 → hidden until A.2 is expanded.
    expect(screen.queryByRole('button', { name: 'A.2.a' })).toBeNull()
  })

  it('expanding a node reveals its children, collapsing hides them', () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: /expand A\.2/i }))
    expect(screen.getByRole('button', { name: 'A.2.a' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /collapse A\.2/i }))
    expect(screen.queryByRole('button', { name: 'A.2.a' })).toBeNull()
  })

  it('renders nothing meaningful when the outline is null', () => {
    const onToggleSelect = vi.fn()
    const onNavigate = vi.fn()
    render(
      <TocSidebar
        outline={null}
        ranges={new Map()}
        currentPath={null}
        selected={new Set()}
        onToggleSelect={onToggleSelect}
        onNavigate={onNavigate}
      />,
    )
    expect(screen.queryByRole('button', { name: 'A' })).toBeNull()
  })
})

describe('TocSidebar navigation', () => {
  it('clicking a row navigates to the start of that section range', () => {
    const { onNavigate } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'A.1' })) // range [2,3]
    expect(onNavigate).toHaveBeenCalledWith(2)
    fireEvent.click(screen.getByRole('button', { name: 'B' })) // range [8,9]
    expect(onNavigate).toHaveBeenCalledWith(8)
  })
})

describe('TocSidebar selection', () => {
  it('toggling a checkbox reports the node path', () => {
    const { onToggleSelect } = setup()
    fireEvent.click(screen.getByRole('checkbox', { name: /select A\.1/i }))
    expect(onToggleSelect).toHaveBeenCalledWith('/0/0')
  })

  it('reflects the controlled selected set as checked boxes', () => {
    setup({ selected: new Set(['/0']) })
    expect((screen.getByRole('checkbox', { name: /select A$/i }) as HTMLInputElement).checked).toBe(
      true,
    )
    expect((screen.getByRole('checkbox', { name: /select B/i }) as HTMLInputElement).checked).toBe(
      false,
    )
  })
})

describe('TocSidebar current-section highlight', () => {
  it('marks the row whose section contains the current page with aria-current', () => {
    setup({ currentPath: '/0/0' })
    expect(screen.getByRole('button', { name: 'A.1' }).getAttribute('aria-current')).toBe('location')
    expect(screen.getByRole('button', { name: 'A' }).getAttribute('aria-current')).toBeNull()
  })
})
