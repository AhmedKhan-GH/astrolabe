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
  dialogues: vi.fn().mockResolvedValue([]),
  readDialogue: vi.fn().mockResolvedValue({
    schemaVersion: 1,
    agentKey: 'claude',
    startedAt: '2026-07-11T10:00:00.000Z',
    messages: [
      { role: 'user', text: 'past question', at: '2026-07-11T10:00:01.000Z' },
      { role: 'agent', text: 'past answer', at: '2026-07-11T10:00:03.000Z' },
    ],
    toolCalls: [{ name: 'search_library', at: '2026-07-11T10:00:02.000Z' }],
    documentIds: [42],
  }),
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

describe('DialoguePane — history browser (v1.1)', () => {
  const past = [
    { file: '2026-07-11T10-00-00-000Z-past-question.json', agentKey: 'claude', startedAt: '2026-07-11T10:00:00.000Z', firstPrompt: 'past question', messageCount: 2 },
    { file: '2026-07-10T09-00-00-000Z-earlier.json', agentKey: 'codex', startedAt: '2026-07-10T09:00:00.000Z', firstPrompt: 'earlier one', messageCount: 4 },
  ]

  it('the History toggle opens a list of past dialogues (agent, first prompt)', async () => {
    const { acp } = setup(ready, { dialogues: vi.fn().mockResolvedValue(past) })
    await waitReady()
    fireEvent.click(screen.getByRole('button', { name: /history/i }))
    expect(await screen.findByText('past question')).toBeTruthy()
    expect(screen.getByText('earlier one')).toBeTruthy()
    expect(acp.dialogues).toHaveBeenCalled()
    // The live prompt box is gone in history mode.
    expect(screen.queryByPlaceholderText(/ask/i)).toBeNull()
  })

  it('clicking an entry opens a read-only transcript with a banner and no prompt box', async () => {
    const { acp } = setup(ready, { dialogues: vi.fn().mockResolvedValue(past) })
    await waitReady()
    fireEvent.click(screen.getByRole('button', { name: /history/i }))
    fireEvent.click(await screen.findByText('past question'))

    // The stored dialogue renders (reused message/chip rendering) with the read-only banner.
    expect(await screen.findByText(/past answer/i)).toBeTruthy()
    expect(screen.getByText(/read-only/i)).toBeTruthy()
    expect(acp.readDialogue).toHaveBeenCalledWith(past[0].file)
    expect(screen.queryByPlaceholderText(/ask/i)).toBeNull()
  })

  it('"back to live" returns to the live session with its prompt box', async () => {
    setup(ready, { dialogues: vi.fn().mockResolvedValue(past) })
    await waitReady()
    fireEvent.click(screen.getByRole('button', { name: /history/i }))
    fireEvent.click(await screen.findByText('past question'))
    await screen.findByText(/read-only/i)
    fireEvent.click(screen.getByRole('button', { name: /back to live/i }))
    await waitFor(() => expect(screen.getByPlaceholderText(/ask/i)).toBeTruthy())
  })
})

describe('DialoguePane — failure recovery (v1.1)', () => {
  it('a mid-session error shows a banner with the reason and a Restart button', async () => {
    setup()
    await waitReady()
    fireEvent.change(promptBox(), { target: { value: 'q' } })
    fireEvent.keyDown(promptBox(), { key: 'Enter' })
    emit({ kind: 'error', reason: 'The agent process exited.' })
    // The reason shows both as the in-context transcript entry and in the restart banner.
    expect((await screen.findAllByText(/agent process exited/i)).length).toBeGreaterThanOrEqual(1)
    expect(screen.getByRole('button', { name: /restart session/i })).toBeTruthy()
  })

  it('Restart starts a new session and preserves the transcript above a divider', async () => {
    const { acp } = setup()
    await waitReady()
    fireEvent.change(promptBox(), { target: { value: 'my question' } })
    fireEvent.keyDown(promptBox(), { key: 'Enter' })
    emit({ kind: 'error', reason: 'boom' })
    acp.newSession.mockResolvedValue({ sessionId: 's2' })
    fireEvent.click(await screen.findByRole('button', { name: /restart session/i }))

    await waitFor(() => expect(acp.newSession).toHaveBeenCalledTimes(2))
    // Prior turn preserved; the restart banner is gone.
    expect(screen.getByText('my question')).toBeTruthy()
    await waitFor(() => expect(screen.queryByRole('button', { name: /restart session/i })).toBeNull())
  })

  it('a newSession error surfaces the same restart banner styling', async () => {
    const { acp } = setup()
    acp.newSession.mockResolvedValue({ error: 'Claude failed to start a session: nope' })
    await waitFor(() => expect(acp.newSession).toHaveBeenCalled())
    expect(await screen.findByText(/failed to start a session/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: /restart session/i })).toBeTruthy()
  })
})
