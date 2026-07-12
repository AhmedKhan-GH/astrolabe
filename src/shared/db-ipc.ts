import { z } from 'zod'

/**
 * Wire contract for the generic typed table-client (salvage-manifest pattern,
 * runway spec step 2). Recorded ceiling (docs/01 audit): FTS, joins, and
 * transactions never go through this channel — they get named channels
 * (`index:search`, `index:rebuild`, steps 3/6).
 */
export const DB_CHANNEL = 'db:query'
export const INDEX_SEARCH_CHANNEL = 'index:search'
export const INDEX_SYNC_CHANNEL = 'index:sync'
export const INDEX_REBUILD_CHANNEL = 'index:rebuild'
// Library Navigator (docs/2026-07-10): the river + rail read paths — joins, so named
// channels (docs/01 ceiling: they never ride the generic table-client).
export const INDEX_BROWSE_CHANNEL = 'index:browse'
export const INDEX_NAV_CHANNEL = 'index:nav'
// Canvas view (docs/2026-07-10-canvas-view-spec §Page-annotation heat): per-page annotation
// counts for one document — a join + json_extract aggregation, so a named channel too. The
// request schema lives with the query module (queries.ts), like search/browse.
export const INDEX_PAGE_ANNOTATIONS_CHANNEL = 'index:page-annotations'
// Notes wave (docs/2026-07-10 notes wave §Links): one document's wiki-link neighborhood —
// outlinks + backlinks in one round-trip. A join over the links table, so a named channel.
export const INDEX_LINKS_CHANNEL = 'index:links'
// Document Hub (docs/2026-07-10-implementation-plan-notes-hub-ink §Step 2): everything one
// document shows in one round-trip — core + instances + tags + virtual collections + annotation
// summary + backlinks + presence. Composes the existing query helpers, so a named channel.
export const INDEX_DOCUMENT_CHANNEL = 'index:document'

const row = z.record(z.string(), z.unknown())
const id = z.number().int().positive()

/** index:links request: the document whose outlinks + backlinks are wanted. */
export const linksRequestSchema = z.object({ documentId: id })
export type LinksRequest = z.infer<typeof linksRequestSchema>

/** index:document request: the document whose composed hub payload is wanted. */
export const documentRequestSchema = z.object({ documentId: id })
export type DocumentRequest = z.infer<typeof documentRequestSchema>

// Eagle↔Zotero sync gestures (2026-07-11-eagle-zotero-sync-spec): move one document's bytes into
// the other system of record via that system's own write API. `to-zotero` promotes an eagle-only
// PDF; `to-eagle` imports a zotero-only PDF. The handler gates BEFORE any network call (exists +
// pdf + file-backed source + idempotent target) then runs the target connector's sync so the
// content-hash join flips presence to `both`. The result reason is user-renderable.
export const RECONCILE_TRANSFER_CHANNEL = 'reconcile:transfer'

/** transfer request: the document to move and which direction. */
export const transferRequestSchema = z.object({
  documentId: id,
  direction: z.enum(['to-zotero', 'to-eagle']),
})
export type TransferRequest = z.infer<typeof transferRequestSchema>
export type TransferDirection = TransferRequest['direction']

/** A write gesture's outcome — `reason` is a ready-to-render sentence on failure. */
export type TransferResult = { ok: true } | { ok: false; reason: string }

export const INDEX_SOURCES_CHANNEL = 'index:sources'
export const INDEX_STATS_CHANNEL = 'index:stats'
export const SYSTEM_OPEN_CHANNEL = 'system:open'
export const SYSTEM_REQUEST_ACCESS_CHANNEL = 'system:request-access'

// Saved views (docs/2026-07-10-lens-saved-views-spec): named lenses persisted as one JSON file
// per view under `<workspace>/.astrolabe/views/`. list → SavedView[]; save({name,q?,filter}) →
// SavedView; delete({slug}) → boolean. The save request + file schemas live WITH the module
// (`src/main/lib/views.ts`), not here: they embed `storedFilterSchema`, which derives from
// `filterSetSchema` (main/index/queries.ts) — importing it into this shared file would invert
// the layer direction and drag drizzle into the preload bundle. Only the layer-free `{slug}`
// delete request stays here, alongside the channel names.
export const VIEWS_LIST_CHANNEL = 'views:list'
export const VIEWS_SAVE_CHANNEL = 'views:save'
export const VIEWS_DELETE_CHANNEL = 'views:delete'

/** A view is addressed by its slug (the file basename); the only field delete needs. */
export const deleteViewRequestSchema = z.object({ slug: z.string().min(1).max(200) })
export type DeleteViewRequest = z.infer<typeof deleteViewRequestSchema>

// Virtual collections (docs/2026-07-10-lens-virtual-collections-spec): M:N, source-independent
// grouping persisted as one JSON file per collection under `<workspace>/.astrolabe/collections/`.
// list → summaries; create({name}) upserts by slug; delete({slug}); add/remove-members take
// document ids (main converts ids ↔ refs). Unlike saved views these request schemas are all
// layer-free (name / slug / document ids — no `filterSetSchema` reach), so they live here beside
// the channel names rather than dragging drizzle into the preload bundle.
export const VCOLLECTIONS_LIST_CHANNEL = 'vcollections:list'
export const VCOLLECTIONS_CREATE_CHANNEL = 'vcollections:create'
export const VCOLLECTIONS_DELETE_CHANNEL = 'vcollections:delete'
export const VCOLLECTIONS_ADD_MEMBERS_CHANNEL = 'vcollections:add-members'
export const VCOLLECTIONS_REMOVE_MEMBERS_CHANNEL = 'vcollections:remove-members'

/** Create request: only the display name; the slug + createdAt are derived server-side. */
export const createVCollectionRequestSchema = z.object({ name: z.string().min(1).max(120) })
export type CreateVCollectionRequest = z.infer<typeof createVCollectionRequestSchema>

/** Delete: addressed by slug (the file basename), like a saved view. */
export const deleteVCollectionRequestSchema = z.object({ slug: z.string().min(1).max(200) })
export type DeleteVCollectionRequest = z.infer<typeof deleteVCollectionRequestSchema>

/** Add/remove members: the target slug plus the affected document ids (main resolves ids ↔ refs). */
export const vcollectionMembersRequestSchema = z.object({
  slug: z.string().min(1).max(200),
  documentIds: z.array(id).max(10_000),
})
export type VCollectionMembersRequest = z.infer<typeof vcollectionMembersRequestSchema>

/** Grant-access probe (macOS TCC): only the known sources are probeable. */
export const requestAccessSchema = z.object({
  sourceKey: z.enum(['zotero', 'eagle', 'obsidian']),
})
export type RequestAccessRequest = z.infer<typeof requestAccessSchema>

/** Deep links may only target the known tools (plus http for future sources). */
const ALLOWED_URI = /^(zotero|eagle|obsidian|https?):/
export const systemOpenSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('uri'), value: z.string().regex(ALLOWED_URI) }),
  z.object({ kind: z.literal('path'), value: z.string().min(1) }),
  z.object({ kind: z.literal('reveal'), value: z.string().min(1) }),
])
export type SystemOpenRequest = z.infer<typeof systemOpenSchema>

// ACP dialogue v1 (2026-07-11-acp-dialogue-spec §Wire): the CLIENT side of the Agent Client
// Protocol. ONE new top-level preload key `acp` (e2e allowlist +1). Requests are invoke-style;
// session updates + permission prompts arrive as webContents.send events, subscribed via preload
// callbacks. The library speaks to the agent ONLY through the index MCP server — no fs/terminal
// client capabilities in v1.
export const ACP_AGENTS_CHANNEL = 'acp:agents'
export const ACP_SESSION_NEW_CHANNEL = 'acp:session-new'
export const ACP_PROMPT_CHANNEL = 'acp:prompt'
export const ACP_CANCEL_CHANNEL = 'acp:cancel'
export const ACP_PERMISSION_RESPONSE_CHANNEL = 'acp:permission-response'
/** Session mode switch (v2 rich client): drive `session/set_mode` on the live agent. */
export const ACP_SET_MODE_CHANNEL = 'acp:set-mode'
/** Config-option set (v2 rich client): drive `session/set_config_option` (model, reasoning
 *  effort, thinking level, fast-mode toggle) on the live agent. */
export const ACP_SET_CONFIG_CHANNEL = 'acp:set-config'
/** History browser (v1.1): list past dialogues + read one back read-only. */
export const ACP_DIALOGUES_LIST_CHANNEL = 'acp:dialogues-list'
export const ACP_DIALOGUES_READ_CHANNEL = 'acp:dialogues-read'
/** Resume a past dialogue (v1.2): `session/load` the stored ACP session id into a fresh live
 *  session, whose replayed transcript rebuilds the pane. Gated on the adapter's `loadSession`
 *  capability + a stored sessionId. */
export const ACP_LOAD_SESSION_CHANNEL = 'acp:load-session'
/** Push events (main → renderer via webContents.send). */
export const ACP_UPDATE_EVENT = 'acp:update'
export const ACP_PERMISSION_REQUEST_EVENT = 'acp:permission-request'

/** The two v1 adapters. The picker shows an adapter only if its binary resolves. */
export const acpAgentKeySchema = z.enum(['claude', 'codex'])
export type AcpAgentKey = z.infer<typeof acpAgentKeySchema>

/** One row in the agent picker. `available` = binary resolves; `authenticated` is best-effort
 *  (real auth is enforced at session-new, which surfaces an `auth_required` error). */
export interface AcpAgentDescriptor {
  key: AcpAgentKey
  label: string
  available: boolean
  authenticated: boolean
  /** Whether this agent advertised `agentCapabilities.loadSession` on its most recent initialize
   *  (v1.2) — gates the history browser's "Continue" affordance. False until the agent has been
   *  spawned at least once (its capability is only known post-initialize). */
  loadSupported?: boolean
}

/** session-new request: which adapter to spawn. */
export const acpSessionNewSchema = z.object({ agentKey: acpAgentKeySchema })
export type AcpSessionNewRequest = z.infer<typeof acpSessionNewSchema>

/** session-new result: the live session id, or a user-renderable error (e.g. auth required). */
export type AcpSessionResult = { sessionId: string } | { error: string }

/** prompt request: the target session and the user's text. Ack returns immediately; the turn's
 *  output streams back as `acp:update` events. */
export const acpPromptSchema = z.object({
  sessionId: z.string().min(1).max(200),
  text: z.string().min(1).max(50_000),
})
export type AcpPromptRequest = z.infer<typeof acpPromptSchema>

/** cancel request: stop the in-flight turn for a session. */
export const acpCancelSchema = z.object({ sessionId: z.string().min(1).max(200) })
export type AcpCancelRequest = z.infer<typeof acpCancelSchema>

/** permission-response: the option the user chose for a pending permission request. The renderer
 *  renders one button per option and echoes back the selected `optionId` (v2 rich client — REPLACES
 *  the old boolean allow). */
export const acpPermissionResponseSchema = z.object({
  requestId: z.string().min(1).max(200),
  optionId: z.string().min(1).max(200),
})
export type AcpPermissionResponse = z.infer<typeof acpPermissionResponseSchema>

/** load-session: resume a stored dialogue's ACP session (`session/load`). Which adapter + the
 *  stored session id. Result is the same `AcpSessionResult` as session-new: the (same) live session
 *  id, or a user-renderable error (adapter no longer has it / doesn't support load). */
export const acpLoadSessionSchema = z.object({
  agentKey: acpAgentKeySchema,
  sessionId: z.string().min(1).max(200),
})
export type AcpLoadSessionRequest = z.infer<typeof acpLoadSessionSchema>

/** set-mode: switch a live session's operational mode (one of its advertised `availableModes`). */
export const acpSetModeSchema = z.object({
  sessionId: z.string().min(1).max(200),
  modeId: z.string().min(1).max(200),
})
export type AcpSetModeRequest = z.infer<typeof acpSetModeSchema>

/** set-config: set one of a live session's config options (`session/set_config_option`). The value
 *  is a value-id string for a `select` option or a boolean for a toggle; the manager routes the two
 *  shapes into the SDK's discriminated request. */
export const acpSetConfigSchema = z.object({
  sessionId: z.string().min(1).max(200),
  configId: z.string().min(1).max(200),
  value: z.union([z.string(), z.boolean()]),
})
export type AcpSetConfigRequest = z.infer<typeof acpSetConfigSchema>

// ── Frozen wire contract (2026-07-11-acp-rich-client-spec §"Frozen wire contract") ──────────────
// The renderer track codes against these types VERBATIM. `AcpUpdateEvent` is a discriminated union
// on `kind`, every variant carrying `sessionId`. Main maps the SDK's `session/update` notification
// variants into these (pure + unit-tested, see src/main/acp/update-map.ts) and synthesizes
// `turn-end`/`error` from the prompt lifecycle. Both sides import these types so the wire stays honest.

/** Tool categories (mirrors the SDK `ToolKind`) — the renderer picks an icon per kind. */
export type AcpToolKind =
  | 'read'
  | 'edit'
  | 'delete'
  | 'move'
  | 'search'
  | 'execute'
  | 'think'
  | 'fetch'
  | 'switch_mode'
  | 'other'

/** Tool execution status (mirrors the SDK `ToolCallStatus`). */
export type AcpToolStatus = 'pending' | 'in_progress' | 'completed' | 'failed'

/** One renderable piece of a tool call's output. `terminal.text` carries the SDK terminal id (the
 *  only wire-visible handle for an embedded terminal; the client has no terminal capability in v2). */
export type AcpToolContentItem =
  | { type: 'text'; text: string }
  | { type: 'diff'; path: string; oldText: string | null; newText: string }
  | { type: 'terminal'; text: string }

/** agent_message_chunk → the streamed agent text. */
export interface AcpChunkEvent {
  sessionId: string
  kind: 'chunk'
  text: string
}

/** agent_thought_chunk → the agent's reasoning (renders as a collapsible "thinking" block). */
export interface AcpThoughtEvent {
  sessionId: string
  kind: 'thought'
  text: string
}

/**
 * tool_call + tool_call_update → ONE unified tool event. The renderer upserts by `toolCallId`;
 * every other field is a partial update (ACP sends only changed fields on `tool_call_update`), so
 * all but `toolCallId` are optional.
 */
export interface AcpToolEvent {
  sessionId: string
  kind: 'tool'
  toolCallId: string
  /** human-readable title of what the tool is doing. */
  title?: string
  /** the tool category (icon hint). */
  toolKind?: AcpToolKind
  status?: AcpToolStatus
  /** the shell command, harvested from an `execute` tool's rawInput. */
  command?: string
  /** produced content: text blocks, file diffs, terminal handles. */
  content?: AcpToolContentItem[]
  /** file locations touched (the "follow-along" seam). */
  locations?: { path: string; line?: number }[]
  /** raw tool input parameters (rendered as JSON for non-execute tools). */
  rawInput?: unknown
  /** a library documentId harvested from the result — the Layer 4→5 provenance seam. */
  documentId?: number
}

/** plan → the agent's live plan/todo list (replaces the prior plan on each update). */
export interface AcpPlanEvent {
  sessionId: string
  kind: 'plan'
  entries: { content: string; priority?: 'high' | 'medium' | 'low'; status: 'pending' | 'in_progress' | 'completed' }[]
}

/** available_commands_update → the slash-command palette. */
export interface AcpCommandsEvent {
  sessionId: string
  kind: 'commands'
  commands: { name: string; description?: string }[]
}

/** current_mode_update + the modes from session/new → the mode switcher. */
export interface AcpModeEvent {
  sessionId: string
  kind: 'mode'
  currentModeId: string
  availableModes?: { id: string; name: string }[]
}

/**
 * One session configuration option (mirrors the SDK `SessionConfigOption`) — a settable model /
 * reasoning-effort / thinking-level selector (`select`) or a fast-mode-style toggle (`boolean`).
 * `values` carries a `select`'s selectable options (flattened across any groups) and is omitted for
 * a `boolean`. Set via `acp:set-config` → `session/set_config_option`.
 */
export interface AcpConfigOption {
  id: string
  name: string
  description?: string
  type: 'select' | 'boolean'
  /** the current value: a value-id (select) or on/off (boolean). */
  currentValue: string | boolean
  /** selectable values for a `select` (id + label); omitted for a `boolean`. */
  values?: { id: string; name: string }[]
}

/**
 * config_option_update (+ the initial options from session/new) → the header config bar. Carries
 * one or more options; the renderer upserts by `id` (like tool cards), so a partial update leaves
 * the rest untouched.
 */
export interface AcpConfigEvent {
  sessionId: string
  kind: 'config'
  options: AcpConfigOption[]
}

/** usage_update → the token/context readout. `cost` is the structured SDK `Cost` flattened to its
 *  numeric `amount` (the wire keeps a single number the UI can render). */
export interface AcpUsageEvent {
  sessionId: string
  kind: 'usage'
  /** tokens currently in context. */
  used: number
  /** total context-window size in tokens. */
  size: number
  /** cumulative session cost amount, if the agent reports one. */
  cost?: number | null
}

/** session_info_update → the session title shown in the header. `title: null` clears it; an absent
 *  title leaves the current one untouched (partial update). */
export interface AcpSessionInfoEvent {
  sessionId: string
  kind: 'session-info'
  title?: string | null
  updatedAt?: string | null
}

/** synthesized on prompt resolution. */
export interface AcpTurnEndEvent {
  sessionId: string
  kind: 'turn-end'
  stopReason?: string
}

/** synthesized on a failed turn / adapter death (stderr tail appended, existing behavior). */
export interface AcpErrorEvent {
  sessionId: string
  kind: 'error'
  reason: string
}

export type AcpUpdateEvent =
  | AcpChunkEvent
  | AcpThoughtEvent
  | AcpToolEvent
  | AcpPlanEvent
  | AcpCommandsEvent
  | AcpModeEvent
  | AcpConfigEvent
  | AcpUsageEvent
  | AcpSessionInfoEvent
  | AcpTurnEndEvent
  | AcpErrorEvent

/** The kind of a permission option (mirrors the SDK `PermissionOptionKind`) — styles the button. */
export type AcpPermissionOptionKind = 'allow_once' | 'allow_always' | 'reject_once' | 'reject_always'

/** A pending permission prompt surfaced to the renderer (spec §Wire: `acp:permission-request`).
 *  Carries the FULL option set; the renderer renders one button per option and answers with the
 *  chosen `optionId`. */
export interface AcpPermissionRequestEvent {
  requestId: string
  sessionId: string
  /** human-readable tool-call title, for the inline permission card. */
  title: string
  /** the tool call this permission gates (upsert key for the referenced tool card). */
  toolCallId?: string
  options: { optionId: string; name: string; kind: AcpPermissionOptionKind }[]
}

/** One row in the history browser (v1.1): a past dialogue reduced to its list card. */
export interface AcpDialogueSummary {
  /** The store's own filename — the key `read` validates and fetches by. */
  file: string
  agentKey: AcpAgentKey
  startedAt: string
  /** First user message, truncated (~80 chars) — the card's subject line. */
  firstPrompt: string
  messageCount: number
  /** The stored ACP session id, if this dialogue recorded one (v1.2) — the "Continue" handle.
   *  Absent on pre-v1.2 files (not resumable). */
  sessionId?: string
}

/** A stored dialogue read back for read-only rendering (mirrors the on-disk DialogueFile shape). */
export interface AcpStoredDialogue {
  schemaVersion: 1
  agentKey: AcpAgentKey
  startedAt: string
  /** The stored ACP session id (v1.2), if recorded — absent on pre-v1.2 files. */
  sessionId?: string
  messages: { role: 'user' | 'agent'; text: string; at: string }[]
  toolCalls: { name: string; at: string }[]
  documentIds: number[]
}

/** dialogues-read request: a store basename (no slashes; the store re-validates the full pattern). */
export const acpDialogueReadSchema = z.object({ file: z.string().min(1).max(300).regex(/^[^/\\]+\.json$/) })
export type AcpDialogueReadRequest = z.infer<typeof acpDialogueReadSchema>

export const dbRequestSchema = z.discriminatedUnion('op', [
  z.object({ table: z.string(), op: z.literal('getAll') }),
  z.object({ table: z.string(), op: z.literal('getById'), id }),
  z.object({ table: z.string(), op: z.literal('create'), values: row }),
  z.object({ table: z.string(), op: z.literal('update'), id, values: row }),
  z.object({ table: z.string(), op: z.literal('delete'), id }),
])
export type DbRequest = z.infer<typeof dbRequestSchema>
