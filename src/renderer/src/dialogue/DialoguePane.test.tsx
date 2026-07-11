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
  setMode: vi.fn().mockResolvedValue(undefined),
  setConfig: vi.fn().mockResolvedValue(undefined),
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

const promptBox = () => screen.getByPlaceholderText(/ask/i) as HTMLTextAreaElement
const waitReady = async () => {
  await waitFor(() => expect(promptBox().disabled).toBe(false))
}
const emit = (u: AcpUpdate) => act(() => updateCb?.(u))
const emitChunk = (text: string) => emit({ kind: 'chunk', sessionId: 's1', text })

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
    emit({ kind: 'turn-end', sessionId: 's1' })
    await waitFor(() => expect(promptBox().disabled).toBe(false))
  })
})

describe('DialoguePane — transcript + provenance', () => {
  it('renders streamed agent markdown', async () => {
    setup()
    await waitReady()
    emitChunk('# Answer\n\nsome **bold** text')
    expect(await screen.findByRole('heading', { name: 'Answer' })).toBeTruthy()
    expect(screen.getByText('bold').tagName).toBe('STRONG')
  })

  it('a provenance scheme link routes to onOpenUri', async () => {
    const { onOpenUri } = setup()
    await waitReady()
    emitChunk('see [the paper](zotero://select/items/ABC)')
    fireEvent.click(await screen.findByText('the paper'))
    expect(onOpenUri).toHaveBeenCalledWith('zotero://select/items/ABC')
  })

  it('a tool card carrying a documentId opens the hub', async () => {
    const { onOpenHub } = setup()
    await waitReady()
    emit({ kind: 'tool', sessionId: 's1', toolCallId: 'tc1', title: 'search_library', toolKind: 'search', status: 'in_progress' })
    emit({ kind: 'tool', sessionId: 's1', toolCallId: 'tc1', title: 'search_library', toolKind: 'search', status: 'completed', documentId: 42 })
    fireEvent.click(await screen.findByRole('button', { name: /hub/i }))
    expect(onOpenHub).toHaveBeenCalledWith(42)
  })

  it('a thought update renders a collapsible thinking block', async () => {
    setup()
    await waitReady()
    emit({ kind: 'thought', sessionId: 's1', text: 'let me reason' })
    expect(await screen.findByText(/thinking/i)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /thinking/i }))
    expect(screen.getByText('let me reason')).toBeTruthy()
  })

  it('a plan update renders the live plan checklist', async () => {
    setup()
    await waitReady()
    emit({ kind: 'plan', sessionId: 's1', entries: [{ content: 'find sources', status: 'in_progress' }] })
    expect(await screen.findByText('find sources')).toBeTruthy()
  })
})

describe('DialoguePane — permission cards', () => {
  const permReq = (over: Partial<AcpPermissionRequest> = {}): AcpPermissionRequest => ({
    requestId: 'r1',
    sessionId: 's1',
    title: 'Run graphify?',
    options: [
      { optionId: 'allow-1', name: 'Allow once', kind: 'allow_once' },
      { optionId: 'reject-1', name: 'Reject', kind: 'reject_once' },
    ],
    ...over,
  })

  it('renders one button per option and answers with the chosen optionId', async () => {
    const { acp } = setup()
    await waitReady()
    act(() => permCb?.(permReq()))
    await screen.findByText(/run graphify\?/i)
    expect(screen.getByRole('button', { name: /allow once/i })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /allow once/i }))
    expect(acp.respondPermission).toHaveBeenCalledWith('r1', 'allow-1')
    await waitFor(() => expect(screen.queryByText(/run graphify\?/i)).toBeNull())
  })

  it('number keys select the matching option on the topmost card', async () => {
    const { acp } = setup()
    await waitReady()
    act(() => permCb?.(permReq({ requestId: 'r2', title: 'Delete files?' })))
    await screen.findByText(/delete files\?/i)
    fireEvent.keyDown(document, { key: '2' })
    expect(acp.respondPermission).toHaveBeenCalledWith('r2', 'reject-1')
  })
})

describe('DialoguePane — slash palette', () => {
  const withCommands = async () => {
    const ctx = setup()
    await waitReady()
    emit({
      kind: 'commands',
      sessionId: 's1',
      commands: [
        { name: 'graphify', description: 'build a knowledge graph' },
        { name: 'summarize', description: 'summarize the doc' },
      ],
    })
    return ctx
  }

  it('typing `/` opens the palette listing available commands', async () => {
    await withCommands()
    fireEvent.change(promptBox(), { target: { value: '/' } })
    expect(await screen.findByRole('listbox', { name: /slash commands/i })).toBeTruthy()
    expect(screen.getByText('/graphify')).toBeTruthy()
    expect(screen.getByText('/summarize')).toBeTruthy()
  })

  it('filters the palette by the typed token', async () => {
    await withCommands()
    fireEvent.change(promptBox(), { target: { value: '/sum' } })
    await screen.findByText('/summarize')
    expect(screen.queryByText('/graphify')).toBeNull()
  })

  it('clicking a command inserts its text into the prompt', async () => {
    await withCommands()
    fireEvent.change(promptBox(), { target: { value: '/gr' } })
    fireEvent.mouseDown(await screen.findByText('/graphify'))
    expect(promptBox().value).toBe('/graphify ')
  })

  it('Enter inserts the highlighted command instead of sending', async () => {
    const { acp } = await withCommands()
    fireEvent.change(promptBox(), { target: { value: '/' } })
    await screen.findByRole('listbox', { name: /slash commands/i })
    fireEvent.keyDown(promptBox(), { key: 'Enter' })
    expect(acp.prompt).not.toHaveBeenCalled()
    expect(promptBox().value).toBe('/graphify ')
  })

  it('Escape closes the palette', async () => {
    await withCommands()
    fireEvent.change(promptBox(), { target: { value: '/' } })
    await screen.findByRole('listbox', { name: /slash commands/i })
    fireEvent.keyDown(promptBox(), { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('listbox', { name: /slash commands/i })).toBeNull())
  })
})

describe('DialoguePane — mode switcher', () => {
  it('a mode update renders a dropdown that calls setMode on change', async () => {
    const { acp } = setup()
    await waitReady()
    emit({
      kind: 'mode',
      sessionId: 's1',
      currentModeId: 'default',
      availableModes: [
        { id: 'default', name: 'Default' },
        { id: 'plan', name: 'Plan' },
      ],
    })
    const select = (await screen.findByLabelText('mode')) as HTMLSelectElement
    expect(select.value).toBe('default')
    fireEvent.change(select, { target: { value: 'plan' } })
    expect(acp.setMode).toHaveBeenCalledWith('s1', 'plan')
  })

  it('no dropdown until modes arrive', async () => {
    setup()
    await waitReady()
    expect(screen.queryByLabelText('mode')).toBeNull()
  })
})

describe('DialoguePane — config bar', () => {
  const emitConfig = () =>
    emit({
      kind: 'config',
      sessionId: 's1',
      options: [
        {
          id: 'model',
          name: 'Model',
          type: 'select',
          currentValue: 'sonnet',
          values: [
            { id: 'sonnet', name: 'Sonnet' },
            { id: 'opus', name: 'Opus' },
          ],
        },
        { id: 'fast', name: 'Fast Mode', type: 'boolean', currentValue: false },
      ],
    })

  it('renders a select config option and calls setConfig with the chosen value-id', async () => {
    const { acp } = setup()
    await waitReady()
    emitConfig()
    const select = (await screen.findByLabelText('Model')) as HTMLSelectElement
    expect(select.value).toBe('sonnet')
    expect(screen.getByRole('option', { name: 'Opus' })).toBeTruthy()
    fireEvent.change(select, { target: { value: 'opus' } })
    expect(acp.setConfig).toHaveBeenCalledWith('s1', 'model', 'opus')
  })

  it('renders a boolean config option as a toggle and calls setConfig with the new boolean', async () => {
    const { acp } = setup()
    await waitReady()
    emitConfig()
    const toggle = (await screen.findByLabelText('Fast Mode')) as HTMLInputElement
    expect(toggle.checked).toBe(false)
    fireEvent.click(toggle)
    expect(acp.setConfig).toHaveBeenCalledWith('s1', 'fast', true)
  })

  it('renders the usage readout and cost', async () => {
    setup()
    await waitReady()
    emit({ kind: 'usage', sessionId: 's1', used: 12_300, size: 200_000, cost: 0.42 })
    const usage = await screen.findByLabelText('usage')
    expect(usage.textContent).toMatch(/12\.3k \/ 200k tokens/)
    expect(usage.textContent).toMatch(/\$0\.42/)
  })

  it('shows the session title when set', async () => {
    setup()
    await waitReady()
    emit({ kind: 'session-info', sessionId: 's1', title: 'Refactoring the reducer' })
    expect(await screen.findByText('Refactoring the reducer')).toBeTruthy()
  })

  it('no config bar until config / usage / title arrive', async () => {
    setup()
    await waitReady()
    expect(screen.queryByLabelText('usage')).toBeNull()
    expect(screen.queryByLabelText('Model')).toBeNull()
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
    expect(screen.queryByPlaceholderText(/ask/i)).toBeNull()
  })

  it('clicking an entry opens a read-only transcript with a banner and no prompt box', async () => {
    const { acp } = setup(ready, { dialogues: vi.fn().mockResolvedValue(past) })
    await waitReady()
    fireEvent.click(screen.getByRole('button', { name: /history/i }))
    fireEvent.click(await screen.findByText('past question'))
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
    emit({ kind: 'error', sessionId: 's1', reason: 'The agent process exited.' })
    expect((await screen.findAllByText(/agent process exited/i)).length).toBeGreaterThanOrEqual(1)
    expect(screen.getByRole('button', { name: /restart session/i })).toBeTruthy()
  })

  it('Restart starts a new session and preserves the transcript above a divider', async () => {
    const { acp } = setup()
    await waitReady()
    fireEvent.change(promptBox(), { target: { value: 'my question' } })
    fireEvent.keyDown(promptBox(), { key: 'Enter' })
    emit({ kind: 'error', sessionId: 's1', reason: 'boom' })
    acp.newSession.mockResolvedValue({ sessionId: 's2' })
    fireEvent.click(await screen.findByRole('button', { name: /restart session/i }))
    await waitFor(() => expect(acp.newSession).toHaveBeenCalledTimes(2))
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
