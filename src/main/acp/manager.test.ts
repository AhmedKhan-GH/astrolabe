import { describe, it, expect, vi } from 'vitest'
import {
  agent,
  PROTOCOL_VERSION,
  type AgentApp,
  type AgentContext,
  type McpServerStdio,
  type NewSessionResponse,
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
 * Asserts: client-capability minimalism, the index-MCP mount payload, chunk forwarding, the FULL
 * permission option set + optionId responses + reject default, initial mode/commands emission,
 * set-mode, the bypassPermissions → default override, and that teardown kills the child.
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
  captured: { initialize?: unknown; newSession?: unknown; setMode: unknown[] }
}

interface ScriptOpts {
  onPrompt?: (client: AgentContext, sessionId: string) => Promise<StopReason>
  newSessionResponse?: NewSessionResponse
}

function scriptedAgent(opts: ScriptOpts = {}): ScriptedAgent {
  const captured: ScriptedAgent['captured'] = { setMode: [] }
  const app = agent({ name: 'scripted' })
    .onRequest('initialize', ({ params }) => {
      captured.initialize = params
      return { protocolVersion: PROTOCOL_VERSION }
    })
    .onRequest('session/new', ({ params }) => {
      captured.newSession = params
      return opts.newSessionResponse ?? { sessionId: 'sess-1' }
    })
    .onRequest('session/set_mode', ({ params }) => {
      captured.setMode.push(params)
      return {}
    })
    .onRequest('session/prompt', async ({ params, client }) => {
      const stopReason = opts.onPrompt ? await opts.onPrompt(client, params.sessionId) : 'end_turn'
      return { stopReason }
    })
    .onNotification('session/cancel', () => {})
  return { app, captured }
}

function harness(scripted: ScriptedAgent, opts?: { permissionTimeoutMs?: number; stderr?: () => string }) {
  const events: AcpUpdateEvent[] = []
  const permRequests: AcpPermissionRequestEvent[] = []
  const kill = vi.fn()
  const channel: AcpChannel = { connect: (app) => app.connect(scripted.app), kill, stderr: opts?.stderr }
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

  it('appends the adapter child stderr tail to a session/new failure (packaging diagnostics)', async () => {
    const app = agent({ name: 'scripted-fail' })
      .onRequest('initialize', () => ({ protocolVersion: PROTOCOL_VERSION }))
      .onRequest('session/new', () => {
        throw new Error('Internal error')
      })
    const scripted: ScriptedAgent = { app, captured: { setMode: [] } }
    const { manager } = harness(scripted, {
      stderr: () => 'node:internal/modules/esm/resolve failed for app.asar/out/mcp/server.mjs\n',
    })

    const res = await manager.newSession('claude')
    expect('error' in res).toBe(true)
    const { error } = res as { error: string }
    expect(error).toContain('Claude failed to start a session')
    expect(error).toContain('--- adapter stderr ---')
    expect(error).toContain('esm/resolve failed')
  })

  it('agents() reports availability from the adapter probe', () => {
    const scripted = scriptedAgent()
    const { manager } = harness(scripted)
    expect(manager.agents()).toEqual([{ key: 'claude', label: 'Claude', available: true, authenticated: true }])
  })
})

describe('createAcpManager — initial mode + commands', () => {
  it('emits an initial mode event from the session/new modes, with availableModes', async () => {
    const scripted = scriptedAgent({
      newSessionResponse: {
        sessionId: 'sess-1',
        modes: {
          currentModeId: 'default',
          availableModes: [
            { id: 'default', name: 'Manual' },
            { id: 'acceptEdits', name: 'Accept Edits' },
          ],
        },
      },
    })
    const { manager, events } = harness(scripted)
    await manager.newSession('claude')

    expect(events).toContainEqual({
      sessionId: 'sess-1',
      kind: 'mode',
      currentModeId: 'default',
      availableModes: [
        { id: 'default', name: 'Manual' },
        { id: 'acceptEdits', name: 'Accept Edits' },
      ],
    })
    // Nothing to override — 'default' already prompts.
    expect(scripted.captured.setMode).toEqual([])
  })

  it('OVERRIDES bypassPermissions → default so request_permission fires', async () => {
    const scripted = scriptedAgent({
      newSessionResponse: {
        sessionId: 'sess-1',
        modes: {
          currentModeId: 'bypassPermissions',
          availableModes: [
            { id: 'default', name: 'Manual' },
            { id: 'bypassPermissions', name: 'Bypass Permissions' },
          ],
        },
      },
    })
    const { manager, events } = harness(scripted)
    await manager.newSession('claude')

    // The client set the mode back to default (bypass shadows canUseTool → no client prompts).
    expect(scripted.captured.setMode).toEqual([{ sessionId: 'sess-1', modeId: 'default' }])
    // The surfaced initial mode reflects the effective (overridden) mode.
    expect(events.find((e) => e.kind === 'mode')).toMatchObject({ currentModeId: 'default' })
  })

  it('does not emit an initial mode event when the agent advertises no modes', async () => {
    const scripted = scriptedAgent()
    const { manager, events } = harness(scripted)
    await manager.newSession('claude')
    expect(events.some((e) => e.kind === 'mode')).toBe(false)
  })
})

describe('createAcpManager — prompt turn', () => {
  it('forwards agent message chunks then a turn-end', async () => {
    const scripted = scriptedAgent({
      onPrompt: async (client, sessionId) => {
        await client.notify('session/update', {
          sessionId,
          update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'from the library' } },
        })
        return 'end_turn'
      },
    })
    const { manager, events } = harness(scripted)
    const { sessionId } = (await manager.newSession('claude')) as { sessionId: string }

    expect(manager.prompt(sessionId, 'hi')).toEqual({ ok: true })
    await vi.waitFor(() => expect(events.some((e) => e.kind === 'turn-end')).toBe(true))

    expect(events).toEqual([
      { sessionId: 'sess-1', kind: 'chunk', text: 'from the library' },
      { sessionId: 'sess-1', kind: 'turn-end', stopReason: 'end_turn' },
    ])
  })

  it('forwards available_commands_update as a commands event during a turn', async () => {
    const scripted = scriptedAgent({
      onPrompt: async (client, sessionId) => {
        await client.notify('session/update', {
          sessionId,
          update: {
            sessionUpdate: 'available_commands_update',
            availableCommands: [{ name: 'research', description: 'Research the codebase' }],
          },
        })
        return 'end_turn'
      },
    })
    const { manager, events } = harness(scripted)
    const { sessionId } = (await manager.newSession('claude')) as { sessionId: string }
    manager.prompt(sessionId, 'go')
    await vi.waitFor(() => expect(events.some((e) => e.kind === 'turn-end')).toBe(true))

    expect(events).toContainEqual({
      sessionId: 'sess-1',
      kind: 'commands',
      commands: [{ name: 'research', description: 'Research the codebase' }],
    })
  })

  it('rejects a prompt for an unknown session', () => {
    const { manager } = harness(scriptedAgent())
    expect(manager.prompt('nope', 'hi')).toEqual({ error: 'No such session.' })
  })

  it('marks a session dead when its turn fails, so the next prompt rejects cleanly', async () => {
    const scripted = scriptedAgent({
      onPrompt: async () => {
        throw new Error('adapter exploded')
      },
    })
    const { manager, events, kill } = harness(scripted)
    const { sessionId } = (await manager.newSession('claude')) as { sessionId: string }

    expect(manager.prompt(sessionId, 'go')).toEqual({ ok: true })
    await vi.waitFor(() => expect(events.some((e) => e.kind === 'error')).toBe(true))

    expect(manager.prompt(sessionId, 'again')).toEqual({ error: 'No such session.' })
    expect(kill).toHaveBeenCalled()
  })

  it('appends the adapter child stderr tail to a failed-turn error (opaque → actionable)', async () => {
    const scripted = scriptedAgent({
      onPrompt: async () => {
        throw new Error('RequestError: Internal error')
      },
    })
    const { manager, events } = harness(scripted, {
      stderr: () => "Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'zod' imported from app.asar/…\n",
    })
    const { sessionId } = (await manager.newSession('claude')) as { sessionId: string }

    manager.prompt(sessionId, 'go')
    await vi.waitFor(() => expect(events.some((e) => e.kind === 'error')).toBe(true))

    const error = events.find((e) => e.kind === 'error') as { reason: string }
    expect(error.reason).toContain('RequestError: Internal error')
    expect(error.reason).toContain('--- adapter stderr ---')
    expect(error.reason).toContain('ERR_MODULE_NOT_FOUND')
  })
})

describe('createAcpManager — set mode', () => {
  it('setMode drives session/set_mode and re-emits the mode', async () => {
    const scripted = scriptedAgent({
      newSessionResponse: {
        sessionId: 'sess-1',
        modes: {
          currentModeId: 'default',
          availableModes: [
            { id: 'default', name: 'Manual' },
            { id: 'plan', name: 'Plan Mode' },
          ],
        },
      },
    })
    const { manager, events } = harness(scripted)
    await manager.newSession('claude')

    manager.setMode('sess-1', 'plan')
    await vi.waitFor(() => expect(scripted.captured.setMode).toContainEqual({ sessionId: 'sess-1', modeId: 'plan' }))
    await vi.waitFor(() =>
      expect(events).toContainEqual({
        sessionId: 'sess-1',
        kind: 'mode',
        currentModeId: 'plan',
        availableModes: [
          { id: 'default', name: 'Manual' },
          { id: 'plan', name: 'Plan Mode' },
        ],
      }),
    )
  })

  it('setMode on an unknown session is a no-op', () => {
    const { manager } = harness(scriptedAgent())
    expect(() => manager.setMode('nope', 'plan')).not.toThrow()
  })
})

describe('createAcpManager — permissions', () => {
  it('forwards the FULL option set + toolCallId and DEFAULT-REJECTS on timeout', async () => {
    let outcome: RequestPermissionResponse | undefined
    const scripted = scriptedAgent({
      onPrompt: async (client, sessionId) => {
        outcome = await client.request('session/request_permission', {
          sessionId,
          toolCall: { toolCallId: 't1', title: 'write_file' },
          options: [
            { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
            { optionId: 'always', name: 'Always Allow', kind: 'allow_always' },
            { optionId: 'deny', name: 'Deny', kind: 'reject_once' },
          ],
        })
        return 'end_turn'
      },
    })
    const { manager, events, permRequests } = harness(scripted, { permissionTimeoutMs: 15 })
    const { sessionId } = (await manager.newSession('claude')) as { sessionId: string }

    manager.prompt(sessionId, 'delete everything')
    await vi.waitFor(() => expect(events.some((e) => e.kind === 'turn-end')).toBe(true))

    expect(permRequests).toHaveLength(1)
    expect(permRequests[0]).toEqual({
      requestId: expect.any(String),
      sessionId: 'sess-1',
      title: 'write_file',
      toolCallId: 't1',
      options: [
        { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
        { optionId: 'always', name: 'Always Allow', kind: 'allow_always' },
        { optionId: 'deny', name: 'Deny', kind: 'reject_once' },
      ],
    })
    // Timeout picks the first reject_* option.
    expect(outcome).toEqual({ outcome: { outcome: 'selected', optionId: 'deny' } })
  })

  it('returns the chosen optionId from an explicit response', async () => {
    let outcome: RequestPermissionResponse | undefined
    const scripted = scriptedAgent({
      onPrompt: async (client, sessionId) => {
        outcome = await client.request('session/request_permission', {
          sessionId,
          toolCall: { toolCallId: 't1', title: 'read_file' },
          options: [
            { optionId: 'yes', name: 'Allow', kind: 'allow_once' },
            { optionId: 'always', name: 'Always', kind: 'allow_always' },
            { optionId: 'no', name: 'Deny', kind: 'reject_once' },
          ],
        })
        return 'end_turn'
      },
    })
    const { manager, events, permRequests } = harness(scripted)
    const { sessionId } = (await manager.newSession('claude')) as { sessionId: string }

    manager.prompt(sessionId, 'read the file')
    await vi.waitFor(() => expect(permRequests).toHaveLength(1))
    manager.respondPermission(permRequests[0]!.requestId, 'always')
    await vi.waitFor(() => expect(events.some((e) => e.kind === 'turn-end')).toBe(true))

    expect(outcome).toEqual({ outcome: { outcome: 'selected', optionId: 'always' } })
  })

  it('cancels the outcome when no reject option is offered on timeout', async () => {
    let outcome: RequestPermissionResponse | undefined
    const scripted = scriptedAgent({
      onPrompt: async (client, sessionId) => {
        outcome = await client.request('session/request_permission', {
          sessionId,
          toolCall: { toolCallId: 't1', title: 'x' },
          options: [{ optionId: 'allow', name: 'Allow', kind: 'allow_once' }],
        })
        return 'end_turn'
      },
    })
    const { manager, events } = harness(scripted, { permissionTimeoutMs: 15 })
    const { sessionId } = (await manager.newSession('claude')) as { sessionId: string }
    manager.prompt(sessionId, 'go')
    await vi.waitFor(() => expect(events.some((e) => e.kind === 'turn-end')).toBe(true))
    expect(outcome).toEqual({ outcome: { outcome: 'cancelled' } })
  })
})

describe('createAcpManager — teardown', () => {
  it('disposeAll kills the child process/channel', async () => {
    const { manager, kill } = harness(scriptedAgent())
    await manager.newSession('claude')
    manager.disposeAll()
    expect(kill).toHaveBeenCalledTimes(1)
  })

  it('disposeAll default-rejects a still-pending permission request', async () => {
    let outcome: RequestPermissionResponse | undefined
    const scripted = scriptedAgent({
      onPrompt: async (client, sessionId) => {
        outcome = await client.request('session/request_permission', {
          sessionId,
          toolCall: { toolCallId: 't1', title: 'x' },
          options: [{ optionId: 'deny', name: 'Deny', kind: 'reject_once' }],
        })
        return 'end_turn'
      },
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
