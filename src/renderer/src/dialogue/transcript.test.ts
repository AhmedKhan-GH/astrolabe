import { describe, it, expect } from 'vitest'
import {
  emptyTranscript,
  applyUpdate,
  appendUserPrompt,
  restartTranscript,
  entriesFromDialogue,
  type Transcript,
  type AgentMessageEntry,
  type ThoughtEntry,
  type ToolCallEntry,
} from './transcript'
import type { AcpStoredDialogue, AcpUpdate } from './types'

const SID = 's1'
/** Build a well-typed update over the frozen union; the caller supplies the discriminant + fields. */
const up = (u: AcpUpdate): AcpUpdate => u
const chunk = (text: string, sessionId = SID): AcpUpdate => ({ kind: 'chunk', sessionId, text })
const fold = (updates: AcpUpdate[], start: Transcript = emptyTranscript(SID)): Transcript =>
  updates.reduce(applyUpdate, start)

describe('transcript — chunk assembly', () => {
  it('accretes consecutive chunks into one agent message', () => {
    const t = fold([chunk('Hello '), chunk('world'), chunk('!')])
    expect(t.entries).toHaveLength(1)
    const m = t.entries[0] as AgentMessageEntry
    expect(m).toMatchObject({ kind: 'message', role: 'agent', text: 'Hello world!' })
  })

  it('starts a fresh agent message after a turn boundary', () => {
    const t = fold([chunk('first turn'), up({ kind: 'turn-end', sessionId: SID }), chunk('second turn')])
    expect(t.entries.filter((e) => e.kind === 'message')).toHaveLength(2)
    expect((t.entries[1] as AgentMessageEntry).text).toBe('second turn')
  })
})

describe('transcript — thought grouping', () => {
  it('folds consecutive thought chunks into one collapsible block', () => {
    const t = fold([
      up({ kind: 'thought', sessionId: SID, text: 'let me ' }),
      up({ kind: 'thought', sessionId: SID, text: 'think about ' }),
      up({ kind: 'thought', sessionId: SID, text: 'this' }),
    ])
    const thoughts = t.entries.filter((e) => e.kind === 'thought') as ThoughtEntry[]
    expect(thoughts).toHaveLength(1)
    expect(thoughts[0].text).toBe('let me think about this')
  })

  it('an intervening chunk breaks the thought run into two blocks', () => {
    const t = fold([
      up({ kind: 'thought', sessionId: SID, text: 'first thought' }),
      chunk('spoken answer'),
      up({ kind: 'thought', sessionId: SID, text: 'second thought' }),
    ])
    expect(t.entries.map((e) => e.kind)).toEqual(['thought', 'message', 'thought'])
    expect((t.entries[0] as ThoughtEntry).text).toBe('first thought')
    expect((t.entries[2] as ThoughtEntry).text).toBe('second thought')
  })
})

describe('transcript — tool upsert lifecycle', () => {
  const tool = (over: Partial<Extract<AcpUpdate, { kind: 'tool' }>>): AcpUpdate => ({
    kind: 'tool',
    sessionId: SID,
    toolCallId: 'tc1',
    title: 'Search library',
    toolKind: 'search',
    status: 'pending',
    ...over,
  })

  it('upserts one card by toolCallId across status transitions (in place)', () => {
    const t = fold([
      tool({ status: 'pending' }),
      tool({ status: 'in_progress' }),
      tool({ status: 'completed', documentId: 42 }),
    ])
    const tools = t.entries.filter((e) => e.kind === 'tool') as ToolCallEntry[]
    expect(tools).toHaveLength(1)
    expect(tools[0]).toMatchObject({ toolCallId: 'tc1', status: 'completed', documentId: 42 })
    expect(t.documentIds).toEqual([42])
  })

  it('accumulates content blocks across updates', () => {
    const t = fold([
      tool({ status: 'in_progress', content: [{ type: 'text', text: 'reading…' }] }),
      tool({ status: 'completed', content: [{ type: 'diff', path: 'a.ts', oldText: 'x', newText: 'y' }] }),
    ])
    const card = t.entries.find((e) => e.kind === 'tool') as ToolCallEntry
    expect(card.content).toHaveLength(2)
    expect(card.content?.[0]).toEqual({ type: 'text', text: 'reading…' })
    expect(card.content?.[1]).toMatchObject({ type: 'diff', path: 'a.ts' })
  })

  it('two distinct toolCallIds are two cards', () => {
    const t = fold([tool({ toolCallId: 'a' }), tool({ toolCallId: 'b' })])
    expect(t.entries.filter((e) => e.kind === 'tool')).toHaveLength(2)
  })

  it('keeps an earlier documentId when a later update omits it', () => {
    const t = fold([tool({ status: 'in_progress', documentId: 7 }), tool({ status: 'completed' })])
    const card = t.entries.find((e) => e.kind === 'tool') as ToolCallEntry
    expect(card.documentId).toBe(7)
  })

  it('interleaves messages and tool cards in stream order', () => {
    const t = fold([chunk('let me look'), tool({ status: 'completed', documentId: 7 }), chunk('found it')])
    expect(t.entries.map((e) => e.kind)).toEqual(['message', 'tool', 'message'])
  })

  it('dedupes documentIds across the dialogue', () => {
    const t = fold([
      tool({ toolCallId: 'a', status: 'completed', documentId: 5 }),
      tool({ toolCallId: 'b', status: 'completed', documentId: 5 }),
    ])
    expect(t.documentIds).toEqual([5])
  })
})

describe('transcript — plan block', () => {
  it('holds the plan and replaces it whole on each update', () => {
    const t = fold([
      up({ kind: 'plan', sessionId: SID, entries: [{ content: 'step 1', status: 'in_progress' }] }),
      up({
        kind: 'plan',
        sessionId: SID,
        entries: [
          { content: 'step 1', status: 'completed' },
          { content: 'step 2', status: 'pending' },
        ],
      }),
    ])
    expect(t.plan).toHaveLength(2)
    expect(t.plan?.[0]).toMatchObject({ content: 'step 1', status: 'completed' })
    // the plan is not folded into the message/tool entry stream
    expect(t.entries).toHaveLength(0)
  })
})

describe('transcript — mode + commands state', () => {
  it('holds availableCommands from a commands update', () => {
    const t = fold([
      up({ kind: 'commands', sessionId: SID, commands: [{ name: 'graphify', description: 'to graph' }] }),
    ])
    expect(t.availableCommands).toEqual([{ name: 'graphify', description: 'to graph' }])
  })

  it('sets currentModeId + availableModes and keeps modes sticky when a later update omits them', () => {
    const t = fold([
      up({
        kind: 'mode',
        sessionId: SID,
        currentModeId: 'default',
        availableModes: [
          { id: 'default', name: 'Default' },
          { id: 'plan', name: 'Plan' },
        ],
      }),
      up({ kind: 'mode', sessionId: SID, currentModeId: 'plan' }),
    ])
    expect(t.currentModeId).toBe('plan')
    expect(t.availableModes).toHaveLength(2)
  })
})

describe('transcript — config / usage / session-info state', () => {
  const model = (currentValue: string): AcpUpdate => ({
    kind: 'config',
    sessionId: SID,
    options: [
      { id: 'model', name: 'Model', type: 'select', currentValue, values: [{ id: 'sonnet', name: 'Sonnet' }, { id: 'opus', name: 'Opus' }] },
    ],
  })

  it('holds config options and upserts by id (a later single-option update updates in place)', () => {
    const t = fold([
      model('sonnet'),
      up({ kind: 'config', sessionId: SID, options: [{ id: 'fast', name: 'Fast Mode', type: 'boolean', currentValue: false }] }),
      model('opus'),
    ])
    expect(t.configOptions).toHaveLength(2)
    expect(t.configOptions.find((o) => o.id === 'model')?.currentValue).toBe('opus')
    expect(t.configOptions.find((o) => o.id === 'fast')?.currentValue).toBe(false)
  })

  it('holds the usage readout, replacing it on each update', () => {
    const t = fold([
      up({ kind: 'usage', sessionId: SID, used: 100, size: 200_000 }),
      up({ kind: 'usage', sessionId: SID, used: 12_300, size: 200_000, cost: 0.42 }),
    ])
    expect(t.usage).toEqual({ used: 12_300, size: 200_000, cost: 0.42 })
  })

  it('sets the session title and clears it on an explicit null', () => {
    const set = fold([up({ kind: 'session-info', sessionId: SID, title: 'Refactor' })])
    expect(set.sessionTitle).toBe('Refactor')
    const cleared = applyUpdate(set, { kind: 'session-info', sessionId: SID, title: null })
    expect(cleared.sessionTitle).toBeNull()
  })

  it('a session-info update without a title leaves the current title untouched', () => {
    const set = fold([up({ kind: 'session-info', sessionId: SID, title: 'Keep me' })])
    const t = applyUpdate(set, { kind: 'session-info', sessionId: SID, updatedAt: '2026-07-11T10:00:00Z' })
    expect(t.sessionTitle).toBe('Keep me')
  })
})

describe('transcript — turn boundaries + streaming', () => {
  it('appendUserPrompt adds a user message and enters streaming', () => {
    const t = appendUserPrompt(emptyTranscript(SID), 'what is in my library?')
    expect(t.streaming).toBe(true)
    expect(t.entries[0]).toMatchObject({ kind: 'message', role: 'user', text: 'what is in my library?' })
  })

  it('turn-end leaves streaming false', () => {
    const t = fold([chunk('answer'), up({ kind: 'turn-end', sessionId: SID })], appendUserPrompt(emptyTranscript(SID), 'q'))
    expect(t.streaming).toBe(false)
  })

  it('an agent chunk after a user prompt does not accrete onto the user message', () => {
    const t = fold([chunk('reply')], appendUserPrompt(emptyTranscript(SID), 'q'))
    expect(t.entries.map((e) => e.kind)).toEqual(['message', 'message'])
    expect((t.entries[1] as AgentMessageEntry).role).toBe('agent')
  })
})

describe('transcript — errors', () => {
  it('an error mid-turn adds an error entry and ends streaming', () => {
    const t = fold(
      [chunk('partial'), up({ kind: 'error', sessionId: SID, reason: 'model overloaded' })],
      appendUserPrompt(emptyTranscript(SID), 'q'),
    )
    expect(t.streaming).toBe(false)
    expect(t.entries[t.entries.length - 1]).toEqual({ kind: 'error', reason: 'model overloaded' })
    expect(t.entries.some((e) => e.kind === 'message' && e.role === 'agent')).toBe(true)
  })
})

describe('transcript — restart (failure recovery)', () => {
  it('preserves prior entries above a divider, clears the plan, and rebinds to the new session', () => {
    const before = fold(
      [chunk('partial'), up({ kind: 'plan', sessionId: SID, entries: [{ content: 's', status: 'pending' }] }), up({ kind: 'error', sessionId: SID, reason: 'process died' })],
      appendUserPrompt(emptyTranscript(SID), 'q'),
    )
    const after = restartTranscript(before, 'new-session')
    expect(after.sessionId).toBe('new-session')
    expect(after.streaming).toBe(false)
    expect(after.plan).toBeNull()
    expect(after.entries.slice(0, before.entries.length)).toEqual(before.entries)
    expect(after.entries[after.entries.length - 1]).toEqual({ kind: 'divider' })
  })

  it('after restart, updates for the new session accrete (old-session updates are ignored)', () => {
    const restarted = restartTranscript(appendUserPrompt(emptyTranscript(SID), 'q'), 'new-session')
    const t = fold([chunk('stale', SID), chunk('fresh', 'new-session')], restarted)
    expect(t.entries.some((e) => e.kind === 'message' && e.role === 'agent' && e.text === 'fresh')).toBe(true)
    expect(t.entries.some((e) => e.kind === 'message' && (e as AgentMessageEntry).text === 'stale')).toBe(false)
  })
})

describe('transcript — entriesFromDialogue (read-only history)', () => {
  const stored: AcpStoredDialogue = {
    schemaVersion: 1,
    agentKey: 'claude',
    startedAt: '2026-07-11T10:00:00.000Z',
    messages: [
      { role: 'user', text: 'what did I highlight?', at: '2026-07-11T10:00:01.000Z' },
      { role: 'agent', text: 'this passage', at: '2026-07-11T10:00:03.000Z' },
    ],
    toolCalls: [{ name: 'search_library', at: '2026-07-11T10:00:02.000Z' }],
    documentIds: [42],
  }

  it('interleaves stored messages and tool calls in timestamp order, tool as completed', () => {
    const entries = entriesFromDialogue(stored)
    expect(entries.map((e) => e.kind)).toEqual(['message', 'tool', 'message'])
    expect((entries[0] as AgentMessageEntry).text).toBe('what did I highlight?')
    expect(entries[1]).toMatchObject({ kind: 'tool', title: 'search_library', status: 'completed' })
    expect((entries[2] as AgentMessageEntry).text).toBe('this passage')
  })
})

describe('transcript — stale session', () => {
  it('ignores updates for a different sessionId', () => {
    const t = fold([chunk('mine'), chunk('not mine', 'other')])
    expect(t.entries).toHaveLength(1)
    expect((t.entries[0] as AgentMessageEntry).text).toBe('mine')
  })

  it('ignores a stale turn-end (does not flip streaming for the wrong session)', () => {
    const start = appendUserPrompt(emptyTranscript(SID), 'q')
    const t = applyUpdate(start, { kind: 'turn-end', sessionId: 'other' })
    expect(t.streaming).toBe(true)
  })
})
