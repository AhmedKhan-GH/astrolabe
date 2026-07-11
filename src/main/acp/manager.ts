import { spawn as spawnProc } from 'node:child_process'
import { Readable, Writable } from 'node:stream'
import {
  client,
  ndJsonStream,
  PROTOCOL_VERSION,
  type ClientApp,
  type ClientConnection,
  type McpServerStdio,
  type PermissionOption,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionModeState,
  type SessionNotification,
  type SetSessionConfigOptionRequest,
  type StopReason,
} from '@agentclientprotocol/sdk'
import type {
  AcpAgentDescriptor,
  AcpAgentKey,
  AcpPermissionRequestEvent,
  AcpSessionResult,
  AcpUpdateEvent,
} from '../../shared/db-ipc'
import {
  adapters as defaultAdapters,
  defaultWhich,
  unpackedPath,
  type Adapter,
  type AcpSpawn,
  type WhichFn,
} from './adapters'
import { mapConfigOption, mapSessionUpdate } from './update-map'
import type { DialogueStore, DialogueWriter } from './dialogue-store'

/**
 * The ACP CLIENT (2026-07-11-acp-dialogue-spec §Architecture/main). One live ACP connection per
 * session: spawn the adapter subprocess, `initialize` with MINIMAL client capabilities (no fs, no
 * terminal — the library speaks only through MCP), `session/new` mounting the INDEX MCP server,
 * then stream prompt turns. `session/update` notifications are mapped to the renderer contract and
 * forwarded; `session/request_permission` is surfaced to the user and DEFAULT-DENIED on
 * timeout/teardown. Adapter death mid-session becomes an error event — main never crashes.
 *
 * Transport is injected via `channelFactory` so unit tests drive a scripted in-process agent
 * instead of a real subprocess.
 */

/** How a client app is wired to an agent (subprocess in prod, in-process scripted agent in tests). */
export interface AcpChannel {
  connect(app: ClientApp): ClientConnection
  kill(): void
  /** The tail (~last 2KB) of the adapter child's stderr, for turning an opaque "Internal error"
   *  into an actionable diagnostic. Optional: the scripted test channel has no real process. */
  stderr?(): string
}
export type ChannelFactory = (spawn: AcpSpawn) => AcpChannel

/** Cap on the retained stderr tail surfaced in error messages (spec: last ~2KB). */
const STDERR_TAIL_BYTES = 2048

/** Production channel: spawn the adapter over stdio and frame it as newline-delimited JSON. The
 *  child's stderr is both mirrored to main's stderr (live debugging) AND kept as a rolling tail so
 *  a failed initialize / session-new / turn can surface WHY (the adapter's own error output). */
export const nodeChannelFactory: ChannelFactory = (spawn) => {
  const child = spawnProc(spawn.command, spawn.args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, ...spawn.env },
  })
  let stderrTail = ''
  child.stderr?.on('data', (chunk: Buffer) => {
    process.stderr.write(chunk) // keep the prior `inherit` behaviour for live logs
    stderrTail = (stderrTail + chunk.toString('utf8')).slice(-STDERR_TAIL_BYTES)
  })
  const stream = ndJsonStream(
    Writable.toWeb(child.stdin!) as WritableStream<Uint8Array>,
    Readable.toWeb(child.stdout!) as ReadableStream<Uint8Array>,
  )
  return {
    connect: (app) => app.connect(stream),
    kill: () => {
      try {
        child.kill()
      } catch {
        // already exited — nothing to kill
      }
    },
    stderr: () => stderrTail,
  }
}

/** Append an adapter child's captured stderr tail to an error message, when there is any. Turns
 *  "RequestError: Internal error" into something that names the real failure (a missing entry, an
 *  ESM-from-asar load error, an auth prompt on stderr, …). */
function withAdapterStderr(message: string, channel: AcpChannel | undefined): string {
  const tail = channel?.stderr?.().trim()
  return tail ? `${message}\n\n--- adapter stderr ---\n${tail}` : message
}

export interface AcpManagerDeps {
  channelFactory: ChannelFactory
  /** The index MCP server spec, bound to the workspace db + app path at the call site. */
  mcpServer: () => McpServerStdio
  /** Absolute working directory for sessions (the workspace root). */
  cwd: string
  onUpdate: (event: AcpUpdateEvent) => void
  onPermissionRequest: (event: AcpPermissionRequestEvent) => void
  adapters?: Adapter[]
  which?: WhichFn
  dialogueStore?: DialogueStore
  /** Default-deny window for an unanswered permission request. Default 30s (spec). */
  permissionTimeoutMs?: number
  clientInfo?: { name: string; version: string }
  /** Injectable clock for deterministic dialogue timestamps in tests. */
  now?: () => Date
}

export interface AcpManager {
  agents(): AcpAgentDescriptor[]
  newSession(agentKey: AcpAgentKey): Promise<AcpSessionResult>
  prompt(sessionId: string, text: string): { ok: true } | { error: string }
  cancel(sessionId: string): void
  /** Answer a pending permission request with the option the user chose. */
  respondPermission(requestId: string, optionId: string): void
  /** Switch a live session's operational mode (one of its advertised availableModes). */
  setMode(sessionId: string, modeId: string): void
  /** Set one of a live session's config options (model / effort / thinking / fast-mode). The value
   *  is a value-id string for a `select` option or a boolean for a toggle. */
  setConfig(sessionId: string, configId: string, value: string | boolean): void
  disposeAll(): void
}

interface Session {
  acpSessionId: string
  agentKey: AcpAgentKey
  conn: ClientConnection
  channel: AcpChannel
  writer: DialogueWriter | undefined
  agentBuffer: string
  closed: boolean
  /** The session's currently active mode + the modes it advertised (for re-emitting on set). */
  currentModeId: string | undefined
  availableModes: { id: string; name: string }[] | undefined
}

interface PendingPermission {
  resolve: (response: RequestPermissionResponse) => void
  options: PermissionOption[]
  timer: ReturnType<typeof setTimeout>
}

/** The default outcome on timeout/teardown: the FIRST reject_* option offered (spec), or a synthetic
 *  'cancelled' outcome when the agent offered no reject option (the tool is aborted either way). */
function rejectOutcome(options: PermissionOption[]): RequestPermissionResponse {
  const opt = options.find((o) => o.kind === 'reject_once' || o.kind === 'reject_always')
  if (opt) return { outcome: { outcome: 'selected', optionId: opt.optionId } }
  return { outcome: { outcome: 'cancelled' } }
}

export function createAcpManager(deps: AcpManagerDeps): AcpManager {
  const adapterList = deps.adapters ?? defaultAdapters
  const which = deps.which ?? defaultWhich
  const permissionTimeoutMs = deps.permissionTimeoutMs ?? 30_000
  const clientInfo = deps.clientInfo ?? { name: 'Astrolabe', version: '0.1.0' }

  const sessions = new Map<string, Session>()
  const pending = new Map<string, PendingPermission>()
  let requestCounter = 0

  const nowIso = (): string => (deps.now ? deps.now() : new Date()).toISOString()

  function onSessionUpdate(params: SessionNotification): void {
    const mapped = mapSessionUpdate(params.sessionId, params.update)
    if (!mapped) return
    deps.onUpdate(mapped)

    const session = sessions.get(params.sessionId)
    if (!session) return
    if (mapped.kind === 'chunk') session.agentBuffer += mapped.text
    // Persist a tool call the first time it appears (the `tool_call` create, not every update) and
    // any harvested documentId — the dialogue store keeps the minimal name/id history.
    if (params.update.sessionUpdate === 'tool_call' && mapped.kind === 'tool' && mapped.title) {
      session.writer?.addToolCall({ name: mapped.title, at: nowIso() })
    }
    if (mapped.kind === 'tool' && mapped.documentId !== undefined) session.writer?.addDocumentId(mapped.documentId)
    // Track autonomous mode changes so setMode re-emits reflect the live mode.
    if (mapped.kind === 'mode') session.currentModeId = mapped.currentModeId
  }

  function onPermission(params: RequestPermissionRequest): Promise<RequestPermissionResponse> {
    const requestId = `perm-${++requestCounter}`
    return new Promise<RequestPermissionResponse>((resolve) => {
      const timer = setTimeout(() => {
        pending.delete(requestId)
        resolve(rejectOutcome(params.options)) // default-reject on timeout (spec)
      }, permissionTimeoutMs)
      if (typeof timer.unref === 'function') timer.unref()
      pending.set(requestId, { resolve, options: params.options, timer })
      // Forward the FULL option set + the gated tool call id (spec §"Frozen wire contract"): the
      // renderer renders one button per option and answers with the chosen optionId.
      deps.onPermissionRequest({
        requestId,
        sessionId: params.sessionId,
        title: params.toolCall.title ?? 'tool call',
        ...(params.toolCall.toolCallId ? { toolCallId: params.toolCall.toolCallId } : {}),
        options: params.options.map((o) => ({ optionId: o.optionId, name: o.name, kind: o.kind })),
      })
    })
  }

  function buildClientApp(): ClientApp {
    // No fs / terminal handlers registered — the client advertises neither capability, so the
    // agent may only reach the library through the mounted MCP server.
    return client({ name: 'astrolabe' })
      .onNotification('session/update', ({ params }) => onSessionUpdate(params))
      .onRequest('session/request_permission', ({ params }) => onPermission(params))
  }

  function endTurn(session: Session, stopReason: StopReason): void {
    if (session.closed) return
    if (session.agentBuffer) session.writer?.addMessage({ role: 'agent', text: session.agentBuffer, at: nowIso() })
    session.writer?.flush() // append-on-turn-end
    session.agentBuffer = ''
    deps.onUpdate({ sessionId: session.acpSessionId, kind: 'turn-end', stopReason })
  }

  function failTurn(session: Session, err: unknown): void {
    if (session.closed) return
    if (session.agentBuffer) session.writer?.addMessage({ role: 'agent', text: session.agentBuffer, at: nowIso() })
    session.writer?.flush()
    session.agentBuffer = ''
    // A failed turn means the adapter is no longer trustworthy: mark the session dead (so later
    // prompts reject with 'No such session.') and tear the child down. The pane offers a restart.
    session.closed = true
    sessions.delete(session.acpSessionId)
    const reason = withAdapterStderr(String(err), session.channel)
    try {
      session.channel.kill()
    } catch {
      // best-effort — the process may already be gone
    }
    deps.onUpdate({ sessionId: session.acpSessionId, kind: 'error', reason })
  }

  function handleDeath(acpSessionId: string): void {
    const session = sessions.get(acpSessionId)
    if (!session || session.closed) return
    session.closed = true
    sessions.delete(acpSessionId)
    deps.onUpdate({ sessionId: acpSessionId, kind: 'error', reason: 'The agent process exited.' })
  }

  function agents(): AcpAgentDescriptor[] {
    return adapterList.map((adapter) => {
      const available = adapter.resolve(which) !== null
      // `authenticated` is optimistic: a cheap probe can't know without spawning, so real auth is
      // enforced at session-new (which surfaces an `auth_required` error the pane renders).
      return { key: adapter.key, label: adapter.label, available, authenticated: available }
    })
  }

  /** If a session opens in `bypassPermissions` (which shadows the client's permission callback),
   *  switch it to `default` so tool calls actually prompt. Best-effort: a set_mode failure leaves
   *  the session as-is rather than sinking session creation. */
  async function ensurePromptingMode(session: Session, modes: SessionModeState | null | undefined): Promise<void> {
    if (modes?.currentModeId !== 'bypassPermissions') return
    if (!modes.availableModes.some((m) => m.id === 'default')) return
    try {
      await session.conn.agent.request('session/set_mode', { sessionId: session.acpSessionId, modeId: 'default' })
      session.currentModeId = 'default'
    } catch {
      // best-effort — keep the reported mode; the pane still shows the (bypass) reality
    }
  }

  async function newSession(agentKey: AcpAgentKey): Promise<AcpSessionResult> {
    const adapter = adapterList.find((a) => a.key === agentKey)
    if (!adapter) return { error: `Unknown agent: ${agentKey}` }
    const spawn = adapter.resolve(which)
    if (!spawn) return { error: `${adapter.label} is not installed.` }

    let channel: AcpChannel | undefined
    let conn: ClientConnection
    try {
      channel = deps.channelFactory(spawn)
      conn = channel.connect(buildClientApp())
    } catch (err) {
      return { error: withAdapterStderr(`Failed to start ${adapter.label}: ${String(err)}`, channel) }
    }

    try {
      await conn.agent.request('initialize', {
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
        clientInfo,
      })
      const res = await conn.agent.request('session/new', {
        // Escape the workspace root out of the asar if it ever resolves there (defensive — the
        // workspace lives in the user's home, but a session cwd must never point inside app.asar).
        cwd: unpackedPath(deps.cwd),
        mcpServers: [deps.mcpServer()],
      })
      const acpSessionId = res.sessionId
      const availableModes = res.modes?.availableModes?.map((m) => ({ id: m.id, name: m.name }))
      const session: Session = {
        acpSessionId,
        agentKey,
        conn,
        channel,
        writer: deps.dialogueStore?.open(agentKey),
        agentBuffer: '',
        closed: false,
        currentModeId: res.modes?.currentModeId,
        availableModes,
      }
      sessions.set(acpSessionId, session)
      // Adapter death mid-session → an error event, never a crash.
      void conn.closed.then(
        () => handleDeath(acpSessionId),
        () => handleDeath(acpSessionId),
      )
      // Turn OFF bypassPermissions so `session/request_permission` reaches the client: the Claude
      // adapter's permissionMode comes from its own settings; `bypassPermissions` fully SHADOWS
      // canUseTool (the SDK auto-approves every tool and never calls the client), so the observed
      // canary saw no prompts. The client's lever is `session/set_mode` — switch back to `default`
      // ("Manual", which prompts) whenever a session opens in bypass. Other modes route through
      // canUseTool, so we leave them (the user's own configurability, per the non-restrict goal).
      await ensurePromptingMode(session, res.modes)
      // Surface the initial mode (from the session/new response) as a `mode` event.
      if (session.currentModeId) {
        deps.onUpdate({
          sessionId: acpSessionId,
          kind: 'mode',
          currentModeId: session.currentModeId,
          ...(session.availableModes ? { availableModes: session.availableModes } : {}),
        })
      }
      // Surface the initial config options (model / effort / thinking / fast-mode), if the agent
      // reported them on session/new, as a `config` event — the header config bar opens filled.
      if (res.configOptions && res.configOptions.length > 0) {
        deps.onUpdate({ sessionId: acpSessionId, kind: 'config', options: res.configOptions.map(mapConfigOption) })
      }
      return { sessionId: acpSessionId }
    } catch (err) {
      channel.kill()
      const message = String(err)
      if (/auth/i.test(message)) {
        const cmd = agentKey === 'claude' ? '`claude`' : '`codex login`'
        return { error: `${adapter.label} needs sign-in. Run ${cmd} in a terminal, then retry.` }
      }
      return { error: withAdapterStderr(`${adapter.label} failed to start a session: ${message}`, channel) }
    }
  }

  function prompt(sessionId: string, text: string): { ok: true } | { error: string } {
    const session = sessions.get(sessionId)
    if (!session || session.closed) return { error: 'No such session.' }
    session.agentBuffer = ''
    session.writer?.addMessage({ role: 'user', text, at: nowIso() })
    // Ack immediately; the turn streams back as events (spec §Wire).
    void session.conn.agent
      .request('session/prompt', { sessionId, prompt: [{ type: 'text', text }] })
      .then((res) => endTurn(session, res.stopReason), (err) => failTurn(session, err))
    return { ok: true }
  }

  function cancel(sessionId: string): void {
    const session = sessions.get(sessionId)
    if (!session || session.closed) return
    void session.conn.agent.notify('session/cancel', { sessionId }).catch(() => {})
  }

  function setMode(sessionId: string, modeId: string): void {
    const session = sessions.get(sessionId)
    if (!session || session.closed) return
    void session.conn.agent
      .request('session/set_mode', { sessionId, modeId })
      .then(() => {
        session.currentModeId = modeId
        deps.onUpdate({
          sessionId,
          kind: 'mode',
          currentModeId: modeId,
          ...(session.availableModes ? { availableModes: session.availableModes } : {}),
        })
      })
      .catch(() => {}) // a rejected set_mode leaves the mode unchanged; the pane keeps its state
  }

  function setConfig(sessionId: string, configId: string, value: string | boolean): void {
    const session = sessions.get(sessionId)
    if (!session || session.closed) return
    // The SDK request is discriminated: a boolean carries `type: 'boolean'`; a select value carries
    // the value-id alone. The response echoes the FULL updated option set, which we re-emit as a
    // `config` event so the header reflects the new value (mirror setMode's re-emit).
    const params: SetSessionConfigOptionRequest =
      typeof value === 'boolean'
        ? { sessionId, configId, value, type: 'boolean' }
        : { sessionId, configId, value }
    void session.conn.agent
      .request('session/set_config_option', params)
      .then((res) => {
        deps.onUpdate({ sessionId, kind: 'config', options: res.configOptions.map(mapConfigOption) })
      })
      .catch(() => {}) // a rejected set leaves the config unchanged; the pane keeps its state
  }

  function respondPermission(requestId: string, optionId: string): void {
    const p = pending.get(requestId)
    if (!p) return
    clearTimeout(p.timer)
    pending.delete(requestId)
    p.resolve({ outcome: { outcome: 'selected', optionId } })
  }

  function disposeAll(): void {
    for (const p of pending.values()) {
      clearTimeout(p.timer)
      p.resolve(rejectOutcome(p.options)) // default-reject on teardown (spec)
    }
    pending.clear()
    for (const session of sessions.values()) {
      session.closed = true
      try {
        session.channel.kill()
      } catch {
        // best-effort
      }
    }
    sessions.clear()
  }

  return { agents, newSession, prompt, cancel, respondPermission, setMode, setConfig, disposeAll }
}
