/**
 * Transcript reducer — the token-heavy logic core of the dialogue pane. It folds an AcpUpdate
 * stream (plus the user's own prompts) into a flat, render-ready transcript: streaming chunks
 * accrete into the open agent message, `thought` chunks group into one collapsible block, `tool`
 * events upsert by toolCallId (status transitions in place, content accumulates), a single live
 * `plan` block is replaced on each update, and the current mode / available modes / available
 * commands are held aside for the header + slash palette. PURE — every function takes state and
 * returns new state, so the component is a thin dispatcher and the model is fully unit-tested.
 */
import type { AcpCommand, AcpMode, AcpStoredDialogue, AcpToolKind, AcpToolStatus, AcpUpdate, PlanEntry, ToolContentItem, ToolLocation } from './types'

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

/** A run of consecutive agent_thought chunks, folded into one collapsible "thinking" block. */
export interface ThoughtEntry {
  kind: 'thought'
  text: string
}

/**
 * A tool call rendered as an expandable card. Upserted by `toolCallId`: status transitions in
 * place (pending → in_progress → completed/failed) and content blocks accumulate across updates.
 */
export interface ToolCallEntry {
  kind: 'tool'
  toolCallId: string
  title: string
  toolKind: AcpToolKind
  status: AcpToolStatus
  command?: string
  content?: ToolContentItem[]
  locations?: ToolLocation[]
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

export type TranscriptEntry =
  | UserMessageEntry
  | AgentMessageEntry
  | ThoughtEntry
  | ToolCallEntry
  | ErrorEntry
  | DividerEntry

export interface Transcript {
  /** The session these entries belong to; updates for any other session are ignored. */
  sessionId: string
  entries: TranscriptEntry[]
  /** True from prompt-send until turn-end/error — drives the prompt-box disable + stop button. */
  streaming: boolean
  /** Every documentId seen across the dialogue (deduped) — the Layer 4→5 graph seam. */
  documentIds: number[]
  /** The single live plan/todo block, replaced whole on each `plan` update (null until one lands). */
  plan: PlanEntry[] | null
  /** The session's current mode id (null until a `mode` update lands). */
  currentModeId: string | null
  /** Modes the user can switch to (feeds the header dropdown); sticky across mode updates. */
  availableModes: AcpMode[]
  /** Slash commands the agent exposes (feeds the palette). */
  availableCommands: AcpCommand[]
  /**
   * Internal: whether the trailing agent message is closed. A turn end or a fresh user prompt
   * seals it so the next chunk opens a NEW agent message rather than accreting onto the old one.
   */
  sealed: boolean
}

export function emptyTranscript(sessionId: string): Transcript {
  return {
    sessionId,
    entries: [],
    streaming: false,
    documentIds: [],
    plan: null,
    currentModeId: null,
    availableModes: [],
    availableCommands: [],
    sealed: true,
  }
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

/** Fold a thought chunk into the trailing thought block, or open a new one if the run just broke. */
function appendThought(state: Transcript, text: string): Transcript {
  const last = state.entries[state.entries.length - 1]
  if (last && last.kind === 'thought') {
    const entries = state.entries.slice(0, -1)
    entries.push({ ...last, text: last.text + text })
    return { ...state, entries }
  }
  return { ...state, entries: [...state.entries, { kind: 'thought', text }] }
}

/**
 * Upsert a tool entry keyed by toolCallId: first sight appends a card; later updates transition
 * status in place, accumulate content blocks, and fill in command/locations/documentId as they
 * arrive (never clobbering a value already seen with an absent one).
 */
function upsertTool(state: Transcript, u: Extract<AcpUpdate, { kind: 'tool' }>): Transcript {
  const documentIds = mergeDocId(state.documentIds, u.documentId)
  const idx = state.entries.findIndex((e) => e.kind === 'tool' && e.toolCallId === u.toolCallId)
  if (idx < 0) {
    const entry: ToolCallEntry = {
      kind: 'tool',
      toolCallId: u.toolCallId,
      // Defaults for a create that arrives as a partial update (rare, but valid per the wire
      // contract): later updates fill the real values in via the merge branch below.
      title: u.title ?? '',
      toolKind: u.toolKind ?? 'other',
      status: u.status ?? 'pending',
      ...(u.command != null ? { command: u.command } : {}),
      ...(u.content != null ? { content: u.content } : {}),
      ...(u.locations != null ? { locations: u.locations } : {}),
      ...(u.documentId != null ? { documentId: u.documentId } : {}),
    }
    return { ...state, entries: [...state.entries, entry], documentIds }
  }
  const prev = state.entries[idx] as ToolCallEntry
  const updated: ToolCallEntry = {
    ...prev,
    status: u.status ?? prev.status,
    title: u.title || prev.title,
    toolKind: u.toolKind || prev.toolKind,
    command: u.command ?? prev.command,
    content: u.content ? [...(prev.content ?? []), ...u.content] : prev.content,
    locations: u.locations ?? prev.locations,
    documentId: prev.documentId ?? u.documentId,
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
    case 'thought':
      return appendThought(state, u.text ?? '')
    case 'tool':
      return upsertTool(state, u)
    case 'plan':
      return { ...state, plan: u.entries }
    case 'commands':
      return { ...state, availableCommands: u.commands }
    case 'mode':
      return {
        ...state,
        currentModeId: u.currentModeId,
        availableModes: u.availableModes ?? state.availableModes,
      }
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
 * updates are ignored (applyUpdate filters on sessionId). The live plan is stale for the new
 * session, so it is cleared; modes/commands (agent-scoped) survive until the new session re-emits.
 */
export function restartTranscript(state: Transcript, newSessionId: string): Transcript {
  return {
    ...state,
    sessionId: newSessionId,
    entries: [...state.entries, { kind: 'divider' }],
    streaming: false,
    sealed: true,
    plan: null,
  }
}

/**
 * Build a read-only transcript from a stored dialogue (history browser). The on-disk shape keeps
 * messages and tool calls in separate arrays; both carry an `at` timestamp, so we interleave by it
 * to recover stream order. Tool cards render as completed (the record is post-hoc; the stored shape
 * omits the rich content/status trail — see spec §Integration).
 */
export function entriesFromDialogue(dialogue: AcpStoredDialogue): TranscriptEntry[] {
  const dated: { at: string; entry: TranscriptEntry }[] = [
    ...dialogue.messages.map((m) => ({
      at: m.at,
      entry: { kind: 'message', role: m.role, text: m.text } as TranscriptEntry,
    })),
    ...dialogue.toolCalls.map((t, i) => ({
      at: t.at,
      entry: {
        kind: 'tool',
        toolCallId: `stored-${i}`,
        title: t.name,
        toolKind: 'other',
        status: 'completed',
      } as TranscriptEntry,
    })),
  ]
  dated.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))
  return dated.map((d) => d.entry)
}
