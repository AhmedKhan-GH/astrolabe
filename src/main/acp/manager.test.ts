import { describe, it, expect, vi } from 'vitest'
import {
  agent,
  PROTOCOL_VERSION,
  type AgentApp,
  type AgentContext,
  type McpServerStdio,
  type RequestPermissionResponse,
  type StopReason,
} from '@agentclientprotocol/sdk'
import { createAcpManager, type AcpChannel } from './manager'
import type { Adapter } from './adapters'
import type { AcpPermissionRequestEvent, AcpUpdateEvent } from '../../shared/db-ipc'

/**
 * Manager protocol tests against a SCRIPTED MOCK transport (spec §Testing). The mock is a real ACP
 * agent (SDK `agent()`) connected in-process to the manager's client — it captures the client's
 * initialize/session-new payloads and drives updates + permission requests during a prompt turn.
 * Asserts: client-capability minimalism, the index-MCP mount payload, chunk forwarding, permission
 * default-deny, and that teardown kills the child.
 */

const MCP_SPEC: McpServerStdio = {
  name: 'astrolabe-index',
  command: '/electron',
  args: ['/app/out/mcp/server.mjs', '/ws/.astrolabe/index.db'],
  env: [{ name: 'ELECTRON_RUN_AS_NODE', value: '1' }],
}

const testAdapter: Adapter = {
  key: 'claude',
  label: 'Claude',
  resolve: () => ({ command: 'x', args: [], env: {} }),
}

interface ScriptedAgent {
  app: AgentApp
  captured: { initialize?: unknown; newSession?: unknown }
}

function scriptedAgent(onPrompt?: (client: AgentContext, sessionId: string) => Promise<StopReason>): ScriptedAgent {
  const captured: ScriptedAgent['captured'] = {}
  const app = agent({ name: 'scripted' })
    .onRequest('initialize', ({ params }) => {
      captured.initialize = params
      return { protocolVersion: PROTOCOL_VERSION }
    })
    .onRequest('session/new', ({ params }) => {
      captured.newSession = params
      return { sessionId: 'sess-1' }
    })
    .onRequest('session/prompt', async ({ params, client }) => {
      const stopReason = onPrompt ? await onPrompt(client, params.sessionId) : 'end_turn'
      return { stopReason }
    })
    .onNotification('session/cancel', () => {})
  return { app, captured }
}

function harness(scripted: ScriptedAgent, opts?: { permissionTimeoutMs?: number }) {
  const events: AcpUpdateEvent[] = []
  const permRequests: AcpPermissionRequestEvent[] = []
  const kill = vi.fn()
  const channel: AcpChannel = { connect: (app) => app.connect(scripted.app), kill }
  const manager = createAcpManager({
    channelFactory: () => channel,
    mcpServer: () => MCP_SPEC,
    cwd: '/ws',
    onUpdate: (e) => events.push(e),
    onPermissionRequest: (e) => permRequests.push(e),
    adapters: [testAdapter],
    which: () => '/bin/x',
    permissionTimeoutMs: opts?.permissionTimeoutMs ?? 30_000,
  })
  return { manager, events, permRequests, kill }
}

describe('createAcpManager — initialization', () => {
  it('advertises MINIMAL client capabilities: no fs, no terminal', async () => {
    const scripted = scriptedAgent()
    const { manager } = harness(scripted)
    await manager.newSession('claude')

    const init = scripted.captured.initialize as { protocolVersion: number; clientCapabilities: { fs: { readTextFile: boolean; writeTextFile: boolean }; terminal: boolean } }
    expect(init.protocolVersion).toBe(PROTOCOL_VERSION)
    expect(init.clientCapabilities.fs).toEqual({ readTextFile: false, writeTextFile: false })
    expect(init.clientCapabilities.terminal).toBe(false)
  })

  it('mounts the index MCP server into session/new with the workspace cwd', async () => {
    const scripted = scriptedAgent()
    const { manager } = harness(scripted)
    await manager.newSession('claude')

    const req = scripted.captured.newSession as { cwd: string; mcpServers: McpServerStdio[] }
    expect(req.cwd).toBe('/ws')
    expect(req.mcpServers).toEqual([MCP_SPEC])
  })

  it('agents() reports availability from the adapter probe', () => {
    const scripted = scriptedAgent()
    const { manager } = harness(scripted)
    expect(manager.agents()).toEqual([{ key: 'claude', label: 'Claude', available: true, authenticated: true }])
  })
})

describe('createAcpManager — prompt turn', () => {
  it('forwards agent message chunks then a turn-end', async () => {
    const scripted = scriptedAgent(async (client, sessionId) => {
      await client.notify('session/update', {
        sessionId,
        update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'from the library' } },
      })
      return 'end_turn'
    })
    const { manager, events } = harness(scripted)
    const { sessionId } = (await manager.newSession('claude')) as { sessionId: string }

    expect(manager.prompt(sessionId, 'hi')).toEqual({ ok: true })
    await vi.waitFor(() => expect(events.some((e) => e.kind === 'turn-end')).toBe(true))

    expect(events).toEqual([
      { sessionId: 'sess-1', kind: 'chunk', text: 'from the library' },
      { sessionId: 'sess-1', kind: 'turn-end', reason: 'end_turn' },
    ])
  })

  it('rejects a prompt for an unknown session', () => {
    const { manager } = harness(scriptedAgent())
    expect(manager.prompt('nope', 'hi')).toEqual({ error: 'No such session.' })
  })

  it('marks a session dead when its turn fails, so the next prompt rejects cleanly', async () => {
    // The adapter dying mid-turn surfaces as a rejected session/prompt → an error update. The
    // session must then be dead: a subsequent prompt() rejects rather than driving a broken conn.
    const scripted = scriptedAgent(async () => {
      throw new Error('adapter exploded')
    })
    const { manager, events, kill } = harness(scripted)
    const { sessionId } = (await manager.newSession('claude')) as { sessionId: string }

    expect(manager.prompt(sessionId, 'go')).toEqual({ ok: true })
    await vi.waitFor(() => expect(events.some((e) => e.kind === 'error')).toBe(true))

    // Dead: further prompts are refused, and the child was torn down.
    expect(manager.prompt(sessionId, 'again')).toEqual({ error: 'No such session.' })
    expect(kill).toHaveBeenCalled()
  })
})

describe('createAcpManager — permissions', () => {
  it('DEFAULT-DENIES a permission request that is never answered (timeout)', async () => {
    let outcome: RequestPermissionResponse | undefined
    const scripted = scriptedAgent(async (client, sessionId) => {
      outcome = await client.request('session/request_permission', {
        sessionId,
        toolCall: { toolCallId: 't1', title: 'write_file' },
        options: [
          { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
          { optionId: 'deny', name: 'Deny', kind: 'reject_once' },
        ],
      })
      return 'end_turn'
    })
    const { manager, events, permRequests } = harness(scripted, { permissionTimeoutMs: 15 })
    const { sessionId } = (await manager.newSession('claude')) as { sessionId: string }

    manager.prompt(sessionId, 'delete everything')
    await vi.waitFor(() => expect(events.some((e) => e.kind === 'turn-end')).toBe(true))

    expect(permRequests).toHaveLength(1)
    expect(permRequests[0]).toMatchObject({ sessionId: 'sess-1', title: 'write_file' })
    expect(outcome).toEqual({ outcome: { outcome: 'selected', optionId: 'deny' } })
  })

  it('honors an explicit allow response', async () => {
    let outcome: RequestPermissionResponse | undefined
    const scripted = scriptedAgent(async (client, sessionId) => {
      outcome = await client.request('session/request_permission', {
        sessionId,
        toolCall: { toolCallId: 't1', title: 'read_file' },
        options: [
          { optionId: 'yes', name: 'Allow', kind: 'allow_once' },
          { optionId: 'no', name: 'Deny', kind: 'reject_once' },
        ],
      })
      return 'end_turn'
    })
    const { manager, events, permRequests } = harness(scripted)
    const { sessionId } = (await manager.newSession('claude')) as { sessionId: string }

    manager.prompt(sessionId, 'read the file')
    await vi.waitFor(() => expect(permRequests).toHaveLength(1))
    manager.respondPermission(permRequests[0]!.requestId, true)
    await vi.waitFor(() => expect(events.some((e) => e.kind === 'turn-end')).toBe(true))

    expect(outcome).toEqual({ outcome: { outcome: 'selected', optionId: 'yes' } })
  })
})

describe('createAcpManager — teardown', () => {
  it('disposeAll kills the child process/channel', async () => {
    const { manager, kill } = harness(scriptedAgent())
    await manager.newSession('claude')
    manager.disposeAll()
    expect(kill).toHaveBeenCalledTimes(1)
  })

  it('disposeAll default-denies a still-pending permission request', async () => {
    let outcome: RequestPermissionResponse | undefined
    const scripted = scriptedAgent(async (client, sessionId) => {
      outcome = await client.request('session/request_permission', {
        sessionId,
        toolCall: { toolCallId: 't1', title: 'x' },
        options: [{ optionId: 'deny', name: 'Deny', kind: 'reject_once' }],
      })
      return 'end_turn'
    })
    const { manager, permRequests } = harness(scripted)
    const { sessionId } = (await manager.newSession('claude')) as { sessionId: string }
    manager.prompt(sessionId, 'go')
    await vi.waitFor(() => expect(permRequests).toHaveLength(1))

    manager.disposeAll()
    await vi.waitFor(() => expect(outcome).toBeDefined())
    expect(outcome).toEqual({ outcome: { outcome: 'selected', optionId: 'deny' } })
  })
})
