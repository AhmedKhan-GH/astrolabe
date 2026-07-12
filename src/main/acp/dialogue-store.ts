import { dirname, join, resolve } from 'node:path'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import type { AcpAgentKey, AcpDialogueSummary } from '../../shared/db-ipc'
import { slugify } from '../lib/slug'

/**
 * The store's own on-disk naming pattern: `<ISO-stamp-with-[:.]-dashed>-<kebab-slug>.json`. `read`
 * validates the requested basename against THIS pattern (and confirms it resolves inside the store
 * dir) so a malicious `file` argument can never escape to path traversal.
 */
const DIALOGUE_FILE_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[a-z0-9]+(?:-[a-z0-9]+)*\.json$/

/** First-prompt preview length in the history list (spec §1: "~80 chars"). */
const FIRST_PROMPT_MAX = 80

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
  /** The ACP session id this dialogue ran as — the handle `session/load` resumes by (v1.2). Absent
   *  on pre-v1.2 files (simply not resumable). */
  sessionId?: string
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
  /** `sessionId` is the live ACP session id (known after session/new or session/load resolves) so a
   *  resumed dialogue can later be continued — it is stamped into the file at first flush. */
  open(agentKey: AcpAgentKey, startedAt?: string, sessionId?: string): DialogueWriter
  /** Past dialogues as summaries, newest first (the v1.1 history browser). */
  list(): AcpDialogueSummary[]
  /** The full stored dialogue for a listed `file`. Throws on any name that isn't one of ours. */
  read(file: string): DialogueFile
}

/** `dialoguesDir` is injected (the workspace's `.astrolabe/dialogues/`) so tests run in a tmp dir.
 *  The dir is created lazily on first flush — a session with no completed turn writes nothing. */
export function createDialogueStore(dialoguesDir: string): DialogueStore {
  function open(agentKey: AcpAgentKey, startedAt = new Date().toISOString(), sessionId?: string): DialogueWriter {
    const state: DialogueFile = {
      schemaVersion: 1,
      agentKey,
      startedAt,
      // Only stamp a sessionId when one is known — `undefined` is dropped by JSON.stringify, so a
      // file lacking the key is simply not resumable (pre-v1.2 dialogues).
      ...(sessionId ? { sessionId } : {}),
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

  function firstPrompt(messages: DialogueMessage[]): string {
    const first = messages.find((m) => m.role === 'user')?.text ?? ''
    return first.length > FIRST_PROMPT_MAX ? first.slice(0, FIRST_PROMPT_MAX).trimEnd() + '…' : first
  }

  function list(): AcpDialogueSummary[] {
    if (!existsSync(dialoguesDir)) return []
    const summaries: AcpDialogueSummary[] = []
    for (const file of readdirSync(dialoguesDir)) {
      if (!DIALOGUE_FILE_PATTERN.test(file)) continue
      try {
        const body = JSON.parse(readFileSync(join(dialoguesDir, file), 'utf-8')) as DialogueFile
        summaries.push({
          file,
          agentKey: body.agentKey,
          startedAt: body.startedAt,
          firstPrompt: firstPrompt(body.messages),
          messageCount: body.messages.length,
          // Surfaced so the history browser can gate the "Continue" affordance (undefined = a
          // pre-v1.2 file with no session id → not resumable).
          ...(body.sessionId ? { sessionId: body.sessionId } : {}),
        })
      } catch {
        // A corrupt/partial file is skipped rather than sinking the whole list.
      }
    }
    // Newest first — ISO timestamps sort lexicographically.
    return summaries.sort((a, b) => (a.startedAt < b.startedAt ? 1 : a.startedAt > b.startedAt ? -1 : 0))
  }

  function read(file: string): DialogueFile {
    if (!DIALOGUE_FILE_PATTERN.test(file)) throw new Error(`Not a dialogue file: ${file}`)
    const dest = resolve(dialoguesDir, file)
    // Defense in depth: the pattern already forbids separators, but confirm it stays in-dir.
    if (dirname(dest) !== resolve(dialoguesDir)) throw new Error(`Refusing to read outside the store: ${file}`)
    return JSON.parse(readFileSync(dest, 'utf-8')) as DialogueFile
  }

  return { open, list, read }
}
