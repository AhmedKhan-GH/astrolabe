import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDialogueStore, type DialogueStore, type DialogueFile } from './dialogue-store'

/**
 * Tier A integration for dialogue persistence (spec §Testing: round-trip writer + file shape).
 * The on-disk artifact is the contract, so this exercises real fs against a tmp dir.
 */

let dir: string
let store: DialogueStore

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'astrolabe-dialogues-'))
  store = createDialogueStore(dir)
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

function onlyFile(): { name: string; body: DialogueFile } {
  const names = readdirSync(dir).filter((f) => f.endsWith('.json'))
  expect(names).toHaveLength(1)
  return { name: names[0]!, body: JSON.parse(readFileSync(join(dir, names[0]!), 'utf-8')) as DialogueFile }
}

describe('createDialogueStore', () => {
  it('writes nothing until the first flush (no completed turn)', () => {
    const w = store.open('claude', '2026-07-11T10:00:00.000Z')
    w.addMessage({ role: 'user', text: 'hi', at: '2026-07-11T10:00:01.000Z' })
    expect(readdirSync(dir)).toEqual([])
    expect(w.path()).toBeNull()
  })

  it('round-trips the full dialogue shape and derives an <ISO>-<slug> filename', () => {
    const w = store.open('claude', '2026-07-11T10:00:00.000Z')
    w.addMessage({ role: 'user', text: 'What did I highlight about precision?', at: '2026-07-11T10:00:01.000Z' })
    w.addToolCall({ name: 'search_library', at: '2026-07-11T10:00:02.000Z' })
    w.addDocumentId(42)
    w.addMessage({ role: 'agent', text: 'You highlighted a passage on precision.', at: '2026-07-11T10:00:03.000Z' })
    w.flush()

    const { name, body } = onlyFile()
    // Stamp is the ISO with colons/dots dashed; slug from the first user message.
    expect(name).toBe('2026-07-11T10-00-00-000Z-what-did-i-highlight-about-precision.json')
    expect(body).toEqual({
      schemaVersion: 1,
      agentKey: 'claude',
      startedAt: '2026-07-11T10:00:00.000Z',
      messages: [
        { role: 'user', text: 'What did I highlight about precision?', at: '2026-07-11T10:00:01.000Z' },
        { role: 'agent', text: 'You highlighted a passage on precision.', at: '2026-07-11T10:00:03.000Z' },
      ],
      toolCalls: [{ name: 'search_library', at: '2026-07-11T10:00:02.000Z' }],
      documentIds: [42],
    })
  })

  it('append-on-turn-end: a second flush overwrites the same file with accumulated turns', () => {
    const w = store.open('codex', '2026-07-11T11:00:00.000Z')
    w.addMessage({ role: 'user', text: 'first', at: 't1' })
    w.addMessage({ role: 'agent', text: 'reply one', at: 't2' })
    w.flush()
    const first = w.path()
    w.addMessage({ role: 'user', text: 'second', at: 't3' })
    w.addMessage({ role: 'agent', text: 'reply two', at: 't4' })
    w.flush()

    // Same file (path stabilized on first flush), now four messages.
    expect(w.path()).toBe(first)
    const { body } = onlyFile()
    expect(body.messages.map((m) => m.text)).toEqual(['first', 'reply one', 'second', 'reply two'])
  })

  it('dedupes documentIds across a turn', () => {
    const w = store.open('claude', '2026-07-11T12:00:00.000Z')
    w.addMessage({ role: 'user', text: 'q', at: 't1' })
    w.addDocumentId(5)
    w.addDocumentId(5)
    w.addDocumentId(6)
    w.flush()
    expect(onlyFile().body.documentIds).toEqual([5, 6])
  })

  it('falls back to the agent key as slug when the first user text is punctuation-only', () => {
    const w = store.open('claude', '2026-07-11T13:00:00.000Z')
    w.addMessage({ role: 'user', text: '!!!', at: 't1' })
    w.flush()
    expect(onlyFile().name).toBe('2026-07-11T13-00-00-000Z-claude.json')
  })
})

describe('createDialogueStore — history browser (v1.1)', () => {
  function seed(agentKey: 'claude' | 'codex', startedAt: string, firstUser: string, extra: (w: ReturnType<DialogueStore['open']>) => void = () => {}) {
    const w = store.open(agentKey, startedAt)
    w.addMessage({ role: 'user', text: firstUser, at: startedAt })
    extra(w)
    w.flush()
    return w
  }

  it('list() returns summaries newest-first with a truncated first prompt + message count', () => {
    seed('claude', '2026-07-11T10:00:00.000Z', 'oldest question', (w) => {
      w.addMessage({ role: 'agent', text: 'answer', at: 't2' })
    })
    seed('codex', '2026-07-11T12:00:00.000Z', 'x'.repeat(120), (w) => {
      w.addToolCall({ name: 'search_library', at: 't2' })
      w.addMessage({ role: 'agent', text: 'reply', at: 't3' })
    })

    const list = store.list()
    expect(list.map((d) => d.startedAt)).toEqual([
      '2026-07-11T12:00:00.000Z',
      '2026-07-11T10:00:00.000Z',
    ])
    expect(list[0]).toMatchObject({ agentKey: 'codex', messageCount: 2 })
    // Truncated to ~80 chars with an ellipsis.
    expect(list[0]!.firstPrompt.length).toBeLessThanOrEqual(81)
    expect(list[0]!.firstPrompt.endsWith('…')).toBe(true)
    expect(list[1]).toMatchObject({ agentKey: 'claude', firstPrompt: 'oldest question', messageCount: 2 })
    // Each entry names its file so read() can fetch it.
    expect(list[0]!.file).toMatch(/^2026-07-11T12-00-00-000Z-.*\.json$/)
  })

  it('list() on an empty/absent dir is []', () => {
    expect(store.list()).toEqual([])
  })

  it('read(file) round-trips the stored dialogue for a listed entry', () => {
    seed('claude', '2026-07-11T10:00:00.000Z', 'what did I highlight?', (w) => {
      w.addToolCall({ name: 'search_library', at: 't2' })
      w.addDocumentId(42)
      w.addMessage({ role: 'agent', text: 'this passage', at: 't3' })
    })
    const { file } = store.list()[0]!
    const body = store.read(file)
    expect(body).toMatchObject({
      schemaVersion: 1,
      agentKey: 'claude',
      documentIds: [42],
    })
    expect(body.messages.map((m) => m.text)).toEqual(['what did I highlight?', 'this passage'])
  })

  it('read() rejects path traversal and non-pattern names', () => {
    seed('claude', '2026-07-11T10:00:00.000Z', 'q')
    expect(() => store.read('../secrets.json')).toThrow()
    expect(() => store.read('..')).toThrow()
    expect(() => store.read('arbitrary.json')).toThrow()
    expect(() => store.read('not-a-dialogue')).toThrow()
  })
})
