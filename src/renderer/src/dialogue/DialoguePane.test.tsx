// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, act } from '@testing-library/react'
import { DialoguePane } from './DialoguePane'
import type { AcpAgent, AcpUpdate, AcpPermissionRequest } from './types'

afterEach(cleanup)

// Captured subscription callbacks so tests can drive the update / permission streams.
let updateCb: ((u: AcpUpdate) => void) | null = null
let permCb: ((r: AcpPermissionRequest) => void) | null = null

const makeAcp = (agents: AcpAgent[]) => ({
  agents: vi.fn().mockResolvedValue(agents),
  newSession: vi.fn().mockResolvedValue({ sessionId: 's1' }),
  prompt: vi.fn().mockResolvedValue(undefined),
  cancel: vi.fn().mockResolvedValue(undefined),
  respondPermission: vi.fn().mockResolvedValue(undefined),
  onUpdate: vi.fn((cb: (u: AcpUpdate) => void) => {
    updateCb = cb
    return () => {}
  }),
  onPermissionRequest: vi.fn((cb: (r: AcpPermissionRequest) => void) => {
    permCb = cb
    return () => {}
  }),
})

type Acp = ReturnType<typeof makeAcp>

const ready: AcpAgent[] = [{ key: 'claude', label: 'Claude', available: true, authenticated: true }]

const setup = (agents: AcpAgent[] = ready, extra: Partial<Acp> = {}) => {
  const acp = { ...makeAcp(agents), ...extra }
  ;(window as unknown as { astrolabe: { acp: Acp } }).astrolabe = { acp }
  const onOpenUri = vi.fn()
  const onOpenHub = vi.fn()
  render(<DialoguePane onOpenUri={onOpenUri} onOpenHub={onOpenHub} />)
  return { acp, onOpenUri, onOpenHub }
}

// Wait until the pane has an active session (prompt box enabled).
const promptBox = () => screen.getByPlaceholderText(/ask/i) as HTMLTextAreaElement
const waitReady = async () => {
  await waitFor(() => expect(promptBox().disabled).toBe(false))
}
const emit = (u: Partial<AcpUpdate>) =>
  act(() => updateCb?.({ sessionId: 's1', kind: 'chunk', ...u }))

beforeEach(() => {
  updateCb = null
  permCb = null
})

describe('DialoguePane — agent picker', () => {
  it('starts a session for the default available+authenticated agent', async () => {
    const { acp } = setup()
    await waitReady()
    expect(acp.newSession).toHaveBeenCalledWith('claude')
  })

  it('disables an unavailable agent option with a hint', async () => {
    setup([
      { key: 'claude', label: 'Claude', available: true, authenticated: true },
      { key: 'codex', label: 'Codex', available: false, authenticated: false },
    ])
    await screen.findByRole('option', { name: /codex/i })
    const opt = screen.getByRole('option', { name: /codex/i }) as HTMLOptionElement
    expect(opt.disabled).toBe(true)
  })

  it('an unauthenticated agent shows the "run claude" line and starts no session', async () => {
    const { acp } = setup([{ key: 'claude', label: 'Claude', available: true, authenticated: false }])
    await screen.findByText(/run .*claude.* in a terminal/i)
    expect(acp.newSession).not.toHaveBeenCalled()
  })

  it('shows an empty state when no agents are available (never crashes)', async () => {
    setup([])
    await screen.findByText(/no agents available/i)
  })
})

describe('DialoguePane — prompt box', () => {
  it('Enter sends the prompt and enters streaming (box disabled, stop shown)', async () => {
    const { acp } = setup()
    await waitReady()
    fireEvent.change(promptBox(), { target: { value: 'what is in my library?' } })
    fireEvent.keyDown(promptBox(), { key: 'Enter' })
    expect(acp.prompt).toHaveBeenCalledWith('s1', 'what is in my library?')
    expect(screen.getByText('what is in my library?')).toBeTruthy()
    expect(promptBox().disabled).toBe(true)
    expect(screen.getByRole('button', { name: /stop/i })).toBeTruthy()
  })

  it('Shift+Enter does not send', async () => {
    const { acp } = setup()
    await waitReady()
    fireEvent.change(promptBox(), { target: { value: 'line one' } })
    fireEvent.keyDown(promptBox(), { key: 'Enter', shiftKey: true })
    expect(acp.prompt).not.toHaveBeenCalled()
  })

  it('the stop button cancels the streaming turn', async () => {
    const { acp } = setup()
    await waitReady()
    fireEvent.change(promptBox(), { target: { value: 'q' } })
    fireEvent.keyDown(promptBox(), { key: 'Enter' })
    fireEvent.click(screen.getByRole('button', { name: /stop/i }))
    expect(acp.cancel).toHaveBeenCalledWith('s1')
  })

  it('turn-end re-enables the prompt box', async () => {
    setup()
    await waitReady()
    fireEvent.change(promptBox(), { target: { value: 'q' } })
    fireEvent.keyDown(promptBox(), { key: 'Enter' })
    expect(promptBox().disabled).toBe(true)
    emit({ kind: 'turn-end' })
    await waitFor(() => expect(promptBox().disabled).toBe(false))
  })
})

describe('DialoguePane — transcript + provenance', () => {
  it('renders streamed agent markdown', async () => {
    setup()
    await waitReady()
    emit({ text: '# Answer\n\nsome **bold** text' })
    expect(await screen.findByRole('heading', { name: 'Answer' })).toBeTruthy()
    expect(screen.getByText('bold').tagName).toBe('STRONG')
  })

  it('a provenance scheme link routes to onOpenUri', async () => {
    const { onOpenUri } = setup()
    await waitReady()
    emit({ text: 'see [the paper](zotero://select/items/ABC)' })
    fireEvent.click(await screen.findByText('the paper'))
    expect(onOpenUri).toHaveBeenCalledWith('zotero://select/items/ABC')
  })

  it('a tool chip carrying a documentId opens the hub', async () => {
    const { onOpenHub } = setup()
    await waitReady()
    emit({ kind: 'tool-call', toolName: 'search_library' })
    emit({ kind: 'tool-result', toolName: 'search_library', toolStatus: 'completed', documentId: 42 })
    const chip = await screen.findByRole('button', { name: /search_library/i })
    fireEvent.click(chip)
    expect(onOpenHub).toHaveBeenCalledWith(42)
  })

  it('a tool chip without a documentId is not a hub button', async () => {
    const { onOpenHub } = setup()
    await waitReady()
    emit({ kind: 'tool-call', toolName: 'think' })
    await screen.findByText(/think/i)
    expect(screen.queryByRole('button', { name: /think/i })).toBeNull()
    expect(onOpenHub).not.toHaveBeenCalled()
  })
})

describe('DialoguePane — permission cards', () => {
  it('shows a permission card and allows once', async () => {
    const { acp } = setup()
    await waitReady()
    act(() => permCb?.({ requestId: 'r1', sessionId: 's1', title: 'Run graphify?' }))
    await screen.findByText(/run graphify\?/i)
    fireEvent.click(screen.getByRole('button', { name: /allow/i }))
    expect(acp.respondPermission).toHaveBeenCalledWith('r1', true)
    await waitFor(() => expect(screen.queryByText(/run graphify\?/i)).toBeNull())
  })

  it('deny responds with allow=false', async () => {
    const { acp } = setup()
    await waitReady()
    act(() => permCb?.({ requestId: 'r2', sessionId: 's1', title: 'Delete files?' }))
    await screen.findByText(/delete files\?/i)
    fireEvent.click(screen.getByRole('button', { name: /deny/i }))
    expect(acp.respondPermission).toHaveBeenCalledWith('r2', false)
  })
})
