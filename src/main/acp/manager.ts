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
  type SessionNotification,
  type StopReason,
} from '@agentclientprotocol/sdk'
import type {
  AcpAgentDescriptor,
  AcpAgentKey,
  AcpPermissionRequestEvent,
  AcpSessionResult,
  AcpUpdateEvent,
} from '../../shared/db-ipc'
import { adapters as defaultAdapters, defaultWhich, type Adapter, type AcpSpawn, type WhichFn } from './adapters'
import { mapSessionUpdate } from './update-map'
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
}
export type ChannelFactory = (spawn: AcpSpawn) => AcpChannel

/** Production channel: spawn the adapter over stdio and frame it as newline-delimited JSON. */
export const nodeChannelFactory: ChannelFactory = (spawn) => {
  const child = spawnProc(spawn.command, spawn.args, {
    stdio: ['pipe', 'pipe', 'inherit'],
    env: { ...process.env, ...spawn.env },
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
  }
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
  respondPermission(requestId: string, allow: boolean): void
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
}

interface PendingPermission {
  resolve: (response: RequestPermissionResponse) => void
  options: PermissionOption[]
  timer: ReturnType<typeof setTimeout>
}

function selectOutcome(options: PermissionOption[], kinds: PermissionOption['kind'][]): RequestPermissionResponse {
  for (const kind of kinds) {
    const opt = options.find((o) => o.kind === kind)
    if (opt) return { outcome: { outcome: 'selected', optionId: opt.optionId } }
  }
  // No matching option offered — 'cancelled' is the safe outcome (the agent aborts the tool).
  return { outcome: { outcome: 'cancelled' } }
}

const allowOutcome = (options: PermissionOption[]): RequestPermissionResponse =>
  selectOutcome(options, ['allow_once', 'allow_always'])
const denyOutcome = (options: PermissionOption[]): RequestPermissionResponse =>
  selectOutcome(options, ['reject_once', 'reject_always'])

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
    if (mapped.kind === 'chunk' && mapped.text) session.agentBuffer += mapped.text
    if (params.update.sessionUpdate === 'tool_call' && mapped.toolName) {
      session.writer?.addToolCall({ name: mapped.toolName, at: nowIso() })
    }
    if (mapped.documentId !== undefined) session.writer?.addDocumentId(mapped.documentId)
  }

  function onPermission(params: RequestPermissionRequest): Promise<RequestPermissionResponse> {
    const requestId = `perm-${++requestCounter}`
    return new Promise<RequestPermissionResponse>((resolve) => {
      const timer = setTimeout(() => {
        pending.delete(requestId)
        resolve(denyOutcome(params.options)) // default-deny on timeout (spec)
      }, permissionTimeoutMs)
      if (typeof timer.unref === 'function') timer.unref()
      pending.set(requestId, { resolve, options: params.options, timer })
      deps.onPermissionRequest({
        requestId,
        sessionId: params.sessionId,
        title: params.toolCall.title ?? 'tool call',
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
    deps.onUpdate({ sessionId: session.acpSessionId, kind: 'turn-end', reason: stopReason })
  }

  function failTurn(session: Session, err: unknown): void {
    if (session.closed) return
    if (session.agentBuffer) session.writer?.addMessage({ role: 'agent', text: session.agentBuffer, at: nowIso() })
    session.writer?.flush()
    session.agentBuffer = ''
    deps.onUpdate({ sessionId: session.acpSessionId, kind: 'error', reason: String(err) })
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

  async function newSession(agentKey: AcpAgentKey): Promise<AcpSessionResult> {
    const adapter = adapterList.find((a) => a.key === agentKey)
    if (!adapter) return { error: `Unknown agent: ${agentKey}` }
    const spawn = adapter.resolve(which)
    if (!spawn) return { error: `${adapter.label} is not installed.` }

    let channel: AcpChannel
    let conn: ClientConnection
    try {
      channel = deps.channelFactory(spawn)
      conn = channel.connect(buildClientApp())
    } catch (err) {
      return { error: `Failed to start ${adapter.label}: ${String(err)}` }
    }

    try {
      await conn.agent.request('initialize', {
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
        clientInfo,
      })
      const res = await conn.agent.request('session/new', {
        cwd: deps.cwd,
        mcpServers: [deps.mcpServer()],
      })
      const acpSessionId = res.sessionId
      sessions.set(acpSessionId, {
        acpSessionId,
        agentKey,
        conn,
        channel,
        writer: deps.dialogueStore?.open(agentKey),
        agentBuffer: '',
        closed: false,
      })
      // Adapter death mid-session → an error event, never a crash.
      void conn.closed.then(
        () => handleDeath(acpSessionId),
        () => handleDeath(acpSessionId),
      )
      return { sessionId: acpSessionId }
    } catch (err) {
      channel.kill()
      const message = String(err)
      if (/auth/i.test(message)) {
        const cmd = agentKey === 'claude' ? '`claude`' : '`codex login`'
        return { error: `${adapter.label} needs sign-in. Run ${cmd} in a terminal, then retry.` }
      }
      return { error: `${adapter.label} failed to start a session: ${message}` }
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

  function respondPermission(requestId: string, allow: boolean): void {
    const p = pending.get(requestId)
    if (!p) return
    clearTimeout(p.timer)
    pending.delete(requestId)
    p.resolve(allow ? allowOutcome(p.options) : denyOutcome(p.options))
  }

  function disposeAll(): void {
    for (const p of pending.values()) {
      clearTimeout(p.timer)
      p.resolve(denyOutcome(p.options)) // default-deny on teardown (spec)
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

  return { agents, newSession, prompt, cancel, respondPermission, disposeAll }
}
