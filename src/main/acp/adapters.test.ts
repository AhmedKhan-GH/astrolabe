import { describe, it, expect } from 'vitest'
import { adapters, mcpServerSpawn, claudeAgentEntry, type WhichFn } from './adapters'

/**
 * Adapter registry unit tests (spec §Testing: availability probe + MCP mount payload). The claude
 * adapter is a bundled dependency so it always resolves through Electron's node; codex depends on
 * a PATH binary, so its availability rides an injected which-probe.
 */

const claude = adapters.find((a) => a.key === 'claude')!
const codex = adapters.find((a) => a.key === 'codex')!

const whichNone: WhichFn = () => null
const whichFinds =
  (path: string): WhichFn =>
  () =>
    path

describe('adapters registry', () => {
  it('exposes exactly the two v1 adapters with labels', () => {
    expect(adapters.map((a) => a.key)).toEqual(['claude', 'codex'])
    expect(claude.label).toBe('Claude')
    expect(codex.label).toBe('Codex')
  })

  it('claude resolves through Electron node (ELECTRON_RUN_AS_NODE) at the bundled bin entry', () => {
    const spawn = claude.resolve(whichNone)
    expect(spawn).not.toBeNull()
    expect(spawn!.command).toBe(process.execPath)
    expect(spawn!.env).toEqual({ ELECTRON_RUN_AS_NODE: '1' })
    // Points at the real resolved claude-agent-acp bin — this is the packaging-robust path.
    expect(spawn!.args).toEqual([claudeAgentEntry()])
    expect(spawn!.args[0]).toMatch(/claude-agent-acp[\\/]dist[\\/]index\.js$/)
  })

  it('codex is unavailable when the binary is not on PATH', () => {
    expect(codex.resolve(whichNone)).toBeNull()
  })

  it('codex resolves to the PATH-found binary when present', () => {
    const spawn = codex.resolve(whichFinds('/usr/local/bin/codex-acp'))
    expect(spawn).toEqual({ command: '/usr/local/bin/codex-acp', args: [], env: {} })
  })
})

describe('mcpServerSpawn (index MCP mount contract)', () => {
  it('runs the bundled stdio server under Electron node with the workspace db as argv', () => {
    const spec = mcpServerSpawn('/App/Contents/Resources/app', '/ws/.astrolabe/index.db')
    expect(spec.command).toBe(process.execPath)
    expect(spec.args).toEqual([
      '/App/Contents/Resources/app/out/mcp/server.mjs',
      '/ws/.astrolabe/index.db',
    ])
    expect(spec.env).toEqual([{ name: 'ELECTRON_RUN_AS_NODE', value: '1' }])
    expect(spec.name).toBe('astrolabe-index')
  })
})
