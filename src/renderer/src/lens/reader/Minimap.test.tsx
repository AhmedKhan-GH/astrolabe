// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import { Minimap } from './Minimap'

afterEach(cleanup)

const setup = (over: Partial<Parameters<typeof Minimap>[0]> = {}) => {
  const onJump = vi.fn()
  render(
    <Minimap
      numPages={5}
      intensities={new Map([[1, 1], [3, 0.4]])}
      currentPage={0}
      onJump={onJump}
      {...over}
    />,
  )
  return { onJump }
}

describe('Minimap', () => {
  it('is labelled and renders one sliver per page', () => {
    setup()
    const strip = screen.getByRole('navigation', { name: /page minimap/i })
    expect(within(strip).getAllByRole('button')).toHaveLength(5)
  })

  it('clicking a sliver jumps to that 0-based page', () => {
    const { onJump } = setup()
    fireEvent.click(screen.getByRole('button', { name: /go to page 3/i })) // 1-based label → index 2
    expect(onJump).toHaveBeenCalledWith(2)
  })

  it('tints slivers by intensity with the amber convention; unheated slivers carry none', () => {
    setup()
    const heated = screen.getByRole('button', { name: /go to page 2/i }) // index 1, intensity 1
    const plain = screen.getByRole('button', { name: /go to page 1/i }) // index 0, no intensity
    expect(heated.style.backgroundColor).toContain('rgba(245, 158, 11')
    expect(plain.style.backgroundColor).toBe('')
  })

  it('marks the current page sliver', () => {
    setup({ currentPage: 2 })
    expect(screen.getByRole('button', { name: /go to page 3/i }).getAttribute('aria-current')).toBe(
      'location',
    )
    expect(
      screen.getByRole('button', { name: /go to page 1/i }).getAttribute('aria-current'),
    ).toBeNull()
  })
})
