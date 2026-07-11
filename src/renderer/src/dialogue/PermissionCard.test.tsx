// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { PermissionCard } from './PermissionCard'
import type { AcpPermissionRequest } from './types'

afterEach(cleanup)

const req = (): AcpPermissionRequest => ({
  requestId: 'r1',
  sessionId: 's1',
  title: 'Run graphify?',
  toolCallId: 'tc1',
  options: [
    { optionId: 'opt-allow-once', name: 'Allow once', kind: 'allow_once' },
    { optionId: 'opt-allow-always', name: 'Always allow', kind: 'allow_always' },
    { optionId: 'opt-reject', name: 'Reject', kind: 'reject_once' },
  ],
})

describe('PermissionCard', () => {
  it('renders one button per option', () => {
    render(<PermissionCard request={req()} onRespond={vi.fn()} />)
    expect(screen.getByRole('button', { name: /allow once/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /always allow/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /reject/i })).toBeTruthy()
  })

  it('clicking an option responds with its optionId', () => {
    const onRespond = vi.fn()
    render(<PermissionCard request={req()} onRespond={onRespond} />)
    fireEvent.click(screen.getByRole('button', { name: /always allow/i }))
    expect(onRespond).toHaveBeenCalledWith('r1', 'opt-allow-always')
  })

  it('styles allow options emerald and reject options zinc', () => {
    render(<PermissionCard request={req()} onRespond={vi.fn()} />)
    expect(screen.getByRole('button', { name: /allow once/i }).className).toMatch(/emerald/)
    expect(screen.getByRole('button', { name: /^.*reject/i }).className).toMatch(/zinc/)
  })

  it('number keys select the matching option when keyboardActive', () => {
    const onRespond = vi.fn()
    render(<PermissionCard request={req()} keyboardActive onRespond={onRespond} />)
    fireEvent.keyDown(document, { key: '3' })
    expect(onRespond).toHaveBeenCalledWith('r1', 'opt-reject')
  })

  it('ignores number keys when not keyboardActive', () => {
    const onRespond = vi.fn()
    render(<PermissionCard request={req()} onRespond={onRespond} />)
    fireEvent.keyDown(document, { key: '1' })
    expect(onRespond).not.toHaveBeenCalled()
  })
})
