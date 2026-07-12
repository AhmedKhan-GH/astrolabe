/**
 * ACP dialogue contract — renderer-local mirror of the main-side (shared/db-ipc) types, kept
 * here so dialogue component/reducer tests never reach for the preload seam (same pattern as
 * lens/types.ts). The authoritative copy lives main-side; this must stay wire-identical with the
 * "Frozen wire contract" of 2026-07-11-acp-rich-client-spec.md.
 */

/** Tool execution lifecycle (frozen contract). */
export type AcpToolStatus = 'pending' | 'in_progress' | 'completed' | 'failed'

/**
 * The ACP ToolKind, driving the ToolCard icon. Left open-ended (`string`) because the wire may
 * carry kinds we don't yet map — the icon table falls back — but the well-known values are named.
 */
export type AcpToolKind =
  | 'read'
  | 'edit'
  | 'delete'
  | 'move'
  | 'search'
  | 'execute'
  | 'think'
  | 'fetch'
  | 'other'
  | (string & {})

/** One rich block inside a tool call's body (frozen contract: text | diff | terminal). */
export type ToolContentItem =
  | { type: 'text'; text: string }
  | { type: 'diff'; path: string; oldText: string | null; newText: string }
  | { type: 'terminal'; text: string }

/** A file/line a tool touched — the provenance/location trail. */
export interface ToolLocation {
  path: string
  line?: number
}

/** One row in the agent's live plan/todo list (frozen contract). */
export interface PlanEntry {
  content: string
  priority?: 'high' | 'medium' | 'low' | (string & {})
  status: 'pending' | 'in_progress' | 'completed' | (string & {})
}

/** One available slash command (feeds the slash palette). */
export interface AcpCommand {
  name: string
  description?: string
}

/** One selectable session mode (feeds the mode switcher). */
export interface AcpMode {
  id: string
  name: string
}

/**
 * One session configuration option (feeds the header config bar). `select` renders a dropdown over
 * `values`; `boolean` renders a toggle. Set via `acp.setConfig(sessionId, id, value)`.
 */
export interface AcpConfigOption {
  id: string
  name: string
  description?: string
  type: 'select' | 'boolean'
  currentValue: string | boolean
  values?: { id: string; name: string }[]
}

/**
 * A streamed session/update notification — a discriminated union on `kind`, all carrying
 * `sessionId` (frozen wire contract). Forwarded from main verbatim-but-typed.
 */
export type AcpUpdate =
  | { kind: 'chunk'; sessionId: string; text: string }
  | { kind: 'thought'; sessionId: string; text: string }
  | { kind: 'turn-end'; sessionId: string; stopReason?: string }
  | { kind: 'error'; sessionId: string; reason: string }
  | {
      kind: 'tool'
      sessionId: string
      toolCallId: string
      // title/toolKind/status are optional: a `tool_call_update` legitimately omits them and the
      // reducer upserts by toolCallId, filling fields in as they arrive (matches the wire contract).
      title?: string
      toolKind?: AcpToolKind
      status?: AcpToolStatus
      command?: string
      content?: ToolContentItem[]
      locations?: ToolLocation[]
      rawInput?: unknown
      /** A library document a tool touched — harvested for provenance + graph linking. */
      documentId?: number
    }
  | { kind: 'plan'; sessionId: string; entries: PlanEntry[] }
  | { kind: 'commands'; sessionId: string; commands: AcpCommand[] }
  | { kind: 'mode'; sessionId: string; currentModeId: string; availableModes?: AcpMode[] }
  | { kind: 'config'; sessionId: string; options: AcpConfigOption[] }
  | { kind: 'usage'; sessionId: string; used: number; size: number; cost?: number | null }
  | { kind: 'session-info'; sessionId: string; title?: string | null; updatedAt?: string | null }

export type AcpUpdateKind = AcpUpdate['kind']

/** One row in the agent picker (an adapter that resolved on PATH, plus its auth state). */
export interface AcpAgent {
  key: string
  label: string
  available: boolean
  authenticated: boolean
  /** Whether this agent supports `session/load` (v1.2) — gates the history "Continue" affordance. */
  loadSupported?: boolean
}

/** How a permission option resolves — drives the button styling (allow → emerald, reject → zinc). */
export type AcpPermissionOptionKind = 'allow_once' | 'allow_always' | 'reject_once' | 'reject_always'

/** One selectable answer to a permission request (frozen contract). */
export interface AcpPermissionOption {
  optionId: string
  name: string
  kind: AcpPermissionOptionKind
}

/**
 * A pending session/request_permission forwarded to the renderer for a user choice. Carries the
 * FULL option set (frozen contract) — the renderer renders one button per option and answers with
 * the chosen `optionId`.
 */
export interface AcpPermissionRequest {
  requestId: string
  sessionId: string
  title: string
  toolCallId?: string
  options: AcpPermissionOption[]
}

/** One row in the history browser (v1.1) — a past dialogue reduced to its list card. */
export interface AcpDialogueSummary {
  file: string
  agentKey: string
  startedAt: string
  firstPrompt: string
  messageCount: number
  /** The stored ACP session id (v1.2), if recorded — the "Continue" handle (absent = not resumable). */
  sessionId?: string
}

/** A stored dialogue read back for read-only rendering (mirrors the on-disk shape). */
export interface AcpStoredDialogue {
  schemaVersion: 1
  agentKey: string
  startedAt: string
  /** The stored ACP session id (v1.2), if recorded — absent on pre-v1.2 files. */
  sessionId?: string
  messages: { role: 'user' | 'agent'; text: string; at: string }[]
  toolCalls: { name: string; at: string }[]
  documentIds: number[]
}

/** The `window.astrolabe.acp` surface (mirrors the preload contract). */
export interface AcpApi {
  agents(): Promise<AcpAgent[]>
  newSession(agentKey: string): Promise<{ sessionId: string } | { error: string }>
  /** Resume a stored dialogue (v1.2): session/load the stored session id into a live session. */
  loadSession(agentKey: string, sessionId: string): Promise<{ sessionId: string } | { error: string }>
  prompt(sessionId: string, text: string): Promise<void>
  cancel(sessionId: string): Promise<void>
  /** Answer a permission request with the chosen option (frozen contract: optionId, not a boolean). */
  respondPermission(requestId: string, optionId: string): Promise<void>
  /** Switch the session's mode (frozen contract: acp:set-mode). */
  setMode(sessionId: string, modeId: string): Promise<void>
  /** Set a session config option — model / effort / thinking / fast-mode (frozen contract: acp:set-config). */
  setConfig(sessionId: string, configId: string, value: string | boolean): Promise<void>
  dialogues(): Promise<AcpDialogueSummary[]>
  readDialogue(file: string): Promise<AcpStoredDialogue>
  onUpdate(cb: (u: AcpUpdate) => void): () => void
  onPermissionRequest(cb: (r: AcpPermissionRequest) => void): () => void
}
