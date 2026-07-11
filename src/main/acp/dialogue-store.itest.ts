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
