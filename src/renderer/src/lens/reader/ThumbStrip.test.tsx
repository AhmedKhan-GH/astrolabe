// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import { ThumbStrip } from './ThumbStrip'

afterEach(cleanup)

const renderThumb = () => vi.fn().mockResolvedValue(undefined)

describe('ThumbStrip', () => {
  it('renders a labelled rail with one button per page', () => {
    render(
      <ThumbStrip
        numPages={3}
        pageLabel={(i) => ['i', 'ii', '1'][i]!}
        currentPage={0}
        renderThumb={renderThumb()}
        onJump={vi.fn()}
      />,
    )
    const rail = screen.getByRole('navigation', { name: /page thumbnails/i })
    expect(within(rail).getAllByRole('button')).toHaveLength(3)
    expect(within(rail).getByRole('button', { name: 'go to page i' })).toBeTruthy()
  })

  it('marks the current page with aria-current and a visible ring', () => {
    render(
      <ThumbStrip
        numPages={3}
        pageLabel={(i) => String(i + 1)}
        currentPage={1}
        renderThumb={renderThumb()}
        onJump={vi.fn()}
      />,
    )
    const current = screen.getByRole('button', { name: 'go to page 2' })
    expect(current.getAttribute('aria-current')).toBe('true')
    expect(current.className).toMatch(/ring-amber-500/)
    const other = screen.getByRole('button', { name: 'go to page 1' })
    expect(other.getAttribute('aria-current')).toBeNull()
  })

  it('jumps to a page (0-based) on click', () => {
    const onJump = vi.fn()
    render(
      <ThumbStrip
        numPages={3}
        pageLabel={(i) => String(i + 1)}
        currentPage={0}
        renderThumb={renderThumb()}
        onJump={onJump}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'go to page 3' }))
    expect(onJump).toHaveBeenCalledWith(2)
  })
})
