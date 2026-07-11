import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import {
  adapters,
  mcpServerSpawn,
  claudeAgentEntry,
  codexAgentEntry,
  resolveCodex,
  unpackedPath,
  type WhichFn,
} from './adapters'

/**
 * Adapter registry unit tests (spec §Testing: availability probe + MCP mount payload). BOTH v1
 * adapters are bundled dependencies now, so each resolves through Electron's node against its
 * package's ESM entry; codex keeps a trivial PATH fallback (a user-managed `codex-acp`) that rides
 * an injected which-probe.
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

  it('codex resolves through Electron node (ELECTRON_RUN_AS_NODE) at the bundled codex-acp entry', () => {
    // codex-acp is a bundled dependency now (an ESM entry, no native binary), so it resolves out of
    // the box even with an empty PATH — spawned exactly like claude, via Electron-as-node.
    const spawn = codex.resolve(whichNone)
    expect(spawn).not.toBeNull()
    expect(spawn!.command).toBe(process.execPath)
    expect(spawn!.env).toEqual({ ELECTRON_RUN_AS_NODE: '1' })
    expect(spawn!.args).toEqual([codexAgentEntry()])
    expect(spawn!.args[0]).toMatch(/codex-acp[\\/]dist[\\/]index\.js$/)
  })
})

describe('codexAgentEntry', () => {
  it('resolves the codex-acp ESM entry to a real file (dev: no asar, so path is unchanged)', () => {
    const entry = codexAgentEntry()
    expect(existsSync(entry)).toBe(true)
    expect(entry).toMatch(/codex-acp[\\/]dist[\\/]index\.js$/)
    // Dev tree has no app.asar segment, so no unpacked rewrite happened.
    expect(entry).not.toContain('app.asar')
  })
})

describe('resolveCodex (bundled-entry-first, PATH fallback)', () => {
  it('prefers the bundled entry (Electron-as-node spawn) over a PATH match', () => {
    const spawn = resolveCodex(whichFinds('/usr/local/bin/codex-acp'), () => '/unpacked/codex-acp/dist/index.js')
    expect(spawn).toEqual({
      command: process.execPath,
      args: ['/unpacked/codex-acp/dist/index.js'],
      env: { ELECTRON_RUN_AS_NODE: '1' },
    })
  })

  it('falls back to a user-managed codex-acp on PATH when the bundled entry is unresolvable', () => {
    const spawn = resolveCodex(whichFinds('/opt/homebrew/bin/codex-acp'), () => null)
    expect(spawn).toEqual({ command: '/opt/homebrew/bin/codex-acp', args: [], env: {} })
  })

  it('is unavailable when neither bundled nor on PATH', () => {
    expect(resolveCodex(whichNone, () => null)).toBeNull()
  })
})

describe('unpackedPath (asar escape)', () => {
  it('rewrites an app.asar path segment to app.asar.unpacked (POSIX)', () => {
    expect(unpackedPath('/App/Contents/Resources/app.asar/out/mcp/server.mjs')).toBe(
      '/App/Contents/Resources/app.asar.unpacked/out/mcp/server.mjs',
    )
  })

  it('rewrites a Windows app.asar path segment', () => {
    expect(unpackedPath('C:\\r\\app.asar\\node_modules\\x\\bin.exe')).toBe(
      'C:\\r\\app.asar.unpacked\\node_modules\\x\\bin.exe',
    )
  })

  it('is a no-op for a dev path with no asar', () => {
    expect(unpackedPath('/repo/node_modules/@x/y/dist/index.js')).toBe('/repo/node_modules/@x/y/dist/index.js')
  })

  it('does not double-rewrite an already-unpacked path', () => {
    const already = '/App/Resources/app.asar.unpacked/out/mcp/server.mjs'
    expect(unpackedPath(already)).toBe(already)
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
