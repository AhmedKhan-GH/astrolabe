import { describe, it, expect } from 'vitest'
import {
  emptyTranscript,
  applyUpdate,
  appendUserPrompt,
  type Transcript,
  type AgentMessageEntry,
  type ToolCallEntry,
} from './transcript'
import type { AcpUpdate } from './types'

const SID = 's1'
const u = (over: Partial<AcpUpdate>): AcpUpdate => ({ sessionId: SID, kind: 'chunk', ...over })
const fold = (updates: AcpUpdate[], start: Transcript = emptyTranscript(SID)): Transcript =>
  updates.reduce(applyUpdate, start)

describe('transcript — chunk assembly', () => {
  it('accretes consecutive chunks into one agent message', () => {
    const t = fold([u({ text: 'Hello ' }), u({ text: 'world' }), u({ text: '!' })])
    expect(t.entries).toHaveLength(1)
    const m = t.entries[0] as AgentMessageEntry
    expect(m).toMatchObject({ kind: 'message', role: 'agent', text: 'Hello world!' })
  })

  it('starts a fresh agent message after a turn boundary', () => {
    const t = fold([
      u({ text: 'first turn' }),
      u({ kind: 'turn-end' }),
      u({ text: 'second turn' }),
    ])
    expect(t.entries.filter((e) => e.kind === 'message')).toHaveLength(2)
    expect((t.entries[1] as AgentMessageEntry).text).toBe('second turn')
  })
})

describe('transcript — tool call lifecycle', () => {
  it('a tool-call chip is added then resolved in place with status + documentId', () => {
    const t = fold([
      u({ kind: 'tool-call', toolName: 'search_library', toolStatus: 'running' }),
      u({ kind: 'tool-result', toolName: 'search_library', toolStatus: 'completed', documentId: 42 }),
    ])
    const tools = t.entries.filter((e) => e.kind === 'tool') as ToolCallEntry[]
    expect(tools).toHaveLength(1)
    expect(tools[0]).toMatchObject({ toolName: 'search_library', status: 'completed', documentId: 42 })
    expect(t.documentIds).toEqual([42])
  })

  it('interleaves messages and tool chips in stream order', () => {
    const t = fold([
      u({ text: 'let me look' }),
      u({ kind: 'tool-call', toolName: 'search_library' }),
      u({ kind: 'tool-result', toolName: 'search_library', documentId: 7 }),
      u({ text: 'found it' }),
    ])
    expect(t.entries.map((e) => e.kind)).toEqual(['message', 'tool', 'message'])
    expect((t.entries[0] as AgentMessageEntry).text).toBe('let me look')
    expect((t.entries[2] as AgentMessageEntry).text).toBe('found it')
  })

  it('a tool-call default status is running before resolution', () => {
    const t = fold([u({ kind: 'tool-call', toolName: 'graphify' })])
    expect((t.entries[0] as ToolCallEntry).status).toBe('running')
  })

  it('a lone tool-result with no prior call still records a chip', () => {
    const t = fold([u({ kind: 'tool-result', toolName: 'x', documentId: 3 })])
    expect(t.entries).toHaveLength(1)
    expect(t.entries[0].kind).toBe('tool')
    expect(t.documentIds).toEqual([3])
  })

  it('dedupes documentIds across the dialogue', () => {
    const t = fold([
      u({ kind: 'tool-call', toolName: 'a' }),
      u({ kind: 'tool-result', toolName: 'a', documentId: 5 }),
      u({ kind: 'tool-call', toolName: 'b' }),
      u({ kind: 'tool-result', toolName: 'b', documentId: 5 }),
    ])
    expect(t.documentIds).toEqual([5])
  })
})

describe('transcript — turn boundaries + streaming', () => {
  it('appendUserPrompt adds a user message and enters streaming', () => {
    const t = appendUserPrompt(emptyTranscript(SID), 'what is in my library?')
    expect(t.streaming).toBe(true)
    expect(t.entries[0]).toMatchObject({ kind: 'message', role: 'user', text: 'what is in my library?' })
  })

  it('turn-end leaves streaming false', () => {
    const t = fold([u({ text: 'answer' }), u({ kind: 'turn-end' })], appendUserPrompt(emptyTranscript(SID), 'q'))
    expect(t.streaming).toBe(false)
  })

  it('an agent chunk after a user prompt does not accrete onto the user message', () => {
    const t = fold([u({ text: 'reply' })], appendUserPrompt(emptyTranscript(SID), 'q'))
    expect(t.entries.map((e) => e.kind)).toEqual(['message', 'message'])
    expect((t.entries[1] as AgentMessageEntry).role).toBe('agent')
  })
})

describe('transcript — errors', () => {
  it('an error mid-turn adds an error entry and ends streaming', () => {
    const t = fold(
      [u({ text: 'partial' }), u({ kind: 'error', reason: 'model overloaded' })],
      appendUserPrompt(emptyTranscript(SID), 'q'),
    )
    expect(t.streaming).toBe(false)
    const err = t.entries[t.entries.length - 1]
    expect(err).toEqual({ kind: 'error', reason: 'model overloaded' })
    // the partial agent text is preserved
    expect(t.entries.some((e) => e.kind === 'message' && e.role === 'agent')).toBe(true)
  })
})

describe('transcript — stale session', () => {
  it('ignores updates for a different sessionId', () => {
    const t = fold([u({ text: 'mine' }), u({ sessionId: 'other', text: 'not mine' })])
    expect(t.entries).toHaveLength(1)
    expect((t.entries[0] as AgentMessageEntry).text).toBe('mine')
  })

  it('ignores a stale turn-end (does not flip streaming for the wrong session)', () => {
    const start = appendUserPrompt(emptyTranscript(SID), 'q')
    const t = applyUpdate(start, u({ sessionId: 'other', kind: 'turn-end' }))
    expect(t.streaming).toBe(true)
  })
})
