/**
 * Transcript reducer — the token-heavy logic core of the dialogue pane. It folds an AcpUpdate
 * stream (plus the user's own prompts) into a flat, render-ready transcript: streaming chunks
 * accrete into the open agent message, tool calls become chips that resolve in place, turn
 * boundaries flip `streaming`, and errors land as their own entry. PURE — every function takes
 * state and returns new state, so the component is a thin dispatcher and the model is fully
 * unit-tested with synthetic updates.
 */
import type { AcpStoredDialogue, AcpUpdate } from './types'

export interface UserMessageEntry {
  kind: 'message'
  role: 'user'
  text: string
}

export interface AgentMessageEntry {
  kind: 'message'
  role: 'agent'
  text: string
}

/** A tool call rendered as a collapsed chip (name + lifecycle status), linkable if it hit a doc. */
export interface ToolCallEntry {
  kind: 'tool'
  toolName: string
  status: string
  documentId?: number
}

export interface ErrorEntry {
  kind: 'error'
  reason: string
}

/** A visible seam between a dead session and the one restarted in its place (failure recovery). */
export interface DividerEntry {
  kind: 'divider'
}

export type TranscriptEntry = UserMessageEntry | AgentMessageEntry | ToolCallEntry | ErrorEntry | DividerEntry

export interface Transcript {
  /** The session these entries belong to; updates for any other session are ignored. */
  sessionId: string
  entries: TranscriptEntry[]
  /** True from prompt-send until turn-end/error — drives the prompt-box disable + stop button. */
  streaming: boolean
  /** Every documentId seen across the dialogue (deduped) — the Layer 4→5 graph seam. */
  documentIds: number[]
  /**
   * Internal: whether the trailing agent message is closed. A turn end or a fresh user prompt
   * seals it so the next chunk opens a NEW agent message rather than accreting onto the old one.
   */
  sealed: boolean
}

export function emptyTranscript(sessionId: string): Transcript {
  return { sessionId, entries: [], streaming: false, documentIds: [], sealed: true }
}

function mergeDocId(ids: number[], id: number | undefined): number[] {
  return id != null && !ids.includes(id) ? [...ids, id] : ids
}

function appendChunk(state: Transcript, text: string): Transcript {
  const last = state.entries[state.entries.length - 1]
  if (last && last.kind === 'message' && last.role === 'agent' && !state.sealed) {
    const entries = state.entries.slice(0, -1)
    entries.push({ ...last, text: last.text + text })
    return { ...state, entries }
  }
  return {
    ...state,
    entries: [...state.entries, { kind: 'message', role: 'agent', text }],
    sealed: false,
  }
}

function addToolCall(state: Transcript, u: AcpUpdate): Transcript {
  const entry: ToolCallEntry = {
    kind: 'tool',
    toolName: u.toolName ?? 'tool',
    status: u.toolStatus ?? 'running',
    ...(u.documentId != null ? { documentId: u.documentId } : {}),
  }
  return {
    ...state,
    entries: [...state.entries, entry],
    documentIds: mergeDocId(state.documentIds, u.documentId),
  }
}

/** Resolve the most recent still-open tool chip (matched by name when the result names one). */
function resolveToolCall(state: Transcript, u: AcpUpdate): Transcript {
  let idx = -1
  for (let i = state.entries.length - 1; i >= 0; i--) {
    const e = state.entries[i]
    if (e.kind === 'tool' && (u.toolName == null || e.toolName === u.toolName)) {
      idx = i
      break
    }
  }
  const documentIds = mergeDocId(state.documentIds, u.documentId)
  if (idx < 0) {
    // No matching call seen — record the result as a standalone chip so nothing is lost.
    const entry: ToolCallEntry = {
      kind: 'tool',
      toolName: u.toolName ?? 'tool',
      status: u.toolStatus ?? 'done',
      ...(u.documentId != null ? { documentId: u.documentId } : {}),
    }
    return { ...state, entries: [...state.entries, entry], documentIds }
  }
  const prev = state.entries[idx] as ToolCallEntry
  const updated: ToolCallEntry = {
    ...prev,
    status: u.toolStatus ?? 'done',
    ...(prev.documentId == null && u.documentId != null ? { documentId: u.documentId } : {}),
  }
  const entries = state.entries.slice()
  entries[idx] = updated
  return { ...state, entries, documentIds }
}

/** Fold one streamed update into the transcript; updates for a stale session are dropped. */
export function applyUpdate(state: Transcript, u: AcpUpdate): Transcript {
  if (u.sessionId !== state.sessionId) return state
  switch (u.kind) {
    case 'chunk':
      return appendChunk(state, u.text ?? '')
    case 'tool-call':
      return addToolCall(state, u)
    case 'tool-result':
      return resolveToolCall(state, u)
    case 'turn-end':
      return { ...state, streaming: false, sealed: true }
    case 'error':
      return {
        ...state,
        entries: [...state.entries, { kind: 'error', reason: u.reason ?? 'agent error' }],
        streaming: false,
        sealed: true,
      }
  }
}

/** Add the user's prompt to the transcript and enter the streaming state. */
export function appendUserPrompt(state: Transcript, text: string): Transcript {
  return {
    ...state,
    entries: [...state.entries, { kind: 'message', role: 'user', text }],
    streaming: true,
    sealed: true,
  }
}

/**
 * Restart after a dead session (failure recovery): keep the whole prior transcript, drop a visible
 * divider, and rebind to the fresh session id so its updates accrete while the old session's stale
 * updates are ignored (applyUpdate filters on sessionId).
 */
export function restartTranscript(state: Transcript, newSessionId: string): Transcript {
  return {
    ...state,
    sessionId: newSessionId,
    entries: [...state.entries, { kind: 'divider' }],
    streaming: false,
    sealed: true,
  }
}

/**
 * Build a read-only transcript from a stored dialogue (history browser). The on-disk shape keeps
 * messages and tool calls in separate arrays; both carry an `at` timestamp, so we interleave by it
 * to recover stream order. Tool chips render as completed (the record is post-hoc; no live status).
 */
export function entriesFromDialogue(dialogue: AcpStoredDialogue): TranscriptEntry[] {
  const dated: { at: string; entry: TranscriptEntry }[] = [
    ...dialogue.messages.map((m) => ({ at: m.at, entry: { kind: 'message', role: m.role, text: m.text } as TranscriptEntry })),
    ...dialogue.toolCalls.map((t) => ({ at: t.at, entry: { kind: 'tool', toolName: t.name, status: 'completed' } as TranscriptEntry })),
  ]
  dated.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))
  return dated.map((d) => d.entry)
}
