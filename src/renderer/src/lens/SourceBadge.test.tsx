// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { SourceBadge } from './SourceBadge'

afterEach(cleanup)

const src = (over: Partial<{ key: string; status: string; documentCount: number }> = {}) => ({
  key: 'obsidian',
  status: 'ok',
  documentCount: 412,
  ...over,
})

describe('SourceBadge', () => {
  it('ok → count in index (+fresh from the last run)', () => {
    render(<SourceBadge src={src()} fresh={7} granting={false} onGrant={vi.fn()} />)
    expect(screen.getByText(/obsidian: 412 in index/)).toBeTruthy()
    expect(screen.getByText('(+7 new)')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('denied → permission denied + a Grant access button dispatching the source key', () => {
    const onGrant = vi.fn()
    render(<SourceBadge src={src({ status: 'denied' })} fresh={null} granting={false} onGrant={onGrant} />)
    expect(screen.getByText(/obsidian: permission denied/)).toBeTruthy()
    screen.getByRole('button', { name: 'Grant access' }).click()
    expect(onGrant).toHaveBeenCalledWith('obsidian')
  })

  it('denied while a grant is pending → button disabled', () => {
    render(<SourceBadge src={src({ status: 'denied' })} fresh={null} granting={true} onGrant={vi.fn()} />)
    expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(true)
  })

  it('unavailable → dim badge, no button', () => {
    render(<SourceBadge src={src({ status: 'unavailable' })} fresh={null} granting={false} onGrant={vi.fn()} />)
    expect(screen.getByText(/obsidian: unavailable/)).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })
})
