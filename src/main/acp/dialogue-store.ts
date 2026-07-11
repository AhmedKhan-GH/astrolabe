import { join } from 'node:path'
import { mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import type { AcpAgentKey } from '../../shared/db-ipc'
import { slugify } from '../lib/slug'

/**
 * Dialogues as first-party artifacts (2026-07-11-acp-dialogue-spec §Persistence; docs/00). One
 * JSON file per dialogue at `<workspace>/.astrolabe/dialogues/<ISO-stamp>-<slug>.json`, so
 * dialogues ride the user's file-sync and stay readable markdown-adjacent JSON. Append-on-turn-end:
 * the writer accumulates in memory and rewrites the whole file atomically each turn (a dialogue is
 * small; a partial file must never be observed). `documentIds` are harvested from tool results —
 * the Layer 4→5 graph-linking seam.
 */

export interface DialogueMessage {
  role: 'user' | 'agent'
  text: string
  at: string
}

export interface DialogueToolCall {
  name: string
  at: string
}

export interface DialogueFile {
  schemaVersion: 1
  agentKey: AcpAgentKey
  startedAt: string
  messages: DialogueMessage[]
  toolCalls: DialogueToolCall[]
  documentIds: number[]
}

/** A single live dialogue's accumulating writer. */
export interface DialogueWriter {
  addMessage(message: DialogueMessage): void
  addToolCall(toolCall: DialogueToolCall): void
  addDocumentId(id: number): void
  /** Persist the current state atomically. Called on turn-end (append-on-turn-end). */
  flush(): void
  /** The file path (stabilizes on first flush once a slug can be derived). */
  readonly path: () => string | null
}

export interface DialogueStore {
  open(agentKey: AcpAgentKey, startedAt?: string): DialogueWriter
}

/** `dialoguesDir` is injected (the workspace's `.astrolabe/dialogues/`) so tests run in a tmp dir.
 *  The dir is created lazily on first flush — a session with no completed turn writes nothing. */
export function createDialogueStore(dialoguesDir: string): DialogueStore {
  function open(agentKey: AcpAgentKey, startedAt = new Date().toISOString()): DialogueWriter {
    const state: DialogueFile = {
      schemaVersion: 1,
      agentKey,
      startedAt,
      messages: [],
      toolCalls: [],
      documentIds: [],
    }
    let filePath: string | null = null

    function resolvePath(): string {
      if (filePath) return filePath
      // Slug from the first user message (the dialogue's subject), else the agent key.
      const seed = state.messages.find((m) => m.role === 'user')?.text ?? agentKey
      const slug = slugify(seed, agentKey)
      const stamp = startedAt.replace(/[:.]/g, '-')
      filePath = join(dialoguesDir, `${stamp}-${slug}.json`)
      return filePath
    }

    return {
      addMessage: (message) => state.messages.push(message),
      addToolCall: (toolCall) => state.toolCalls.push(toolCall),
      addDocumentId: (id) => {
        if (!state.documentIds.includes(id)) state.documentIds.push(id)
      },
      flush: () => {
        const dest = resolvePath()
        mkdirSync(dialoguesDir, { recursive: true })
        const tmp = `${dest}.${randomUUID()}.tmp`
        writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n')
        renameSync(tmp, dest)
      },
      path: () => filePath,
    }
  }

  return { open }
}
