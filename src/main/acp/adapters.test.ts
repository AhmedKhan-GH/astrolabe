import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import {
  adapters,
  mcpServerSpawn,
  claudeAgentEntry,
  codexBundledBinary,
  resolveCodex,
  unpackedPath,
  type WhichFn,
} from './adapters'

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

  it('codex resolves to the BUNDLED native binary (works out of the box, even with an empty PATH)', () => {
    // In this repo the @zed-industries/codex-acp platform package is installed, so the bundled
    // binary wins regardless of PATH. It must be a real, on-disk native executable.
    const spawn = codex.resolve(whichNone)
    expect(spawn).not.toBeNull()
    expect(spawn!.args).toEqual([])
    expect(spawn!.env).toEqual({})
    expect(spawn!.command).toBe(codexBundledBinary())
    expect(spawn!.command).toMatch(/codex-acp[^/\\]*[/\\]bin[/\\]codex-acp(\.exe)?$/)
    expect(existsSync(spawn!.command)).toBe(true)
  })
})

describe('codexBundledBinary', () => {
  it('resolves the platform-binary package to a real file (dev: no asar, so path is unchanged)', () => {
    const bin = codexBundledBinary()
    expect(bin).not.toBeNull()
    expect(existsSync(bin!)).toBe(true)
    // Dev tree has no app.asar segment, so no unpacked rewrite happened.
    expect(bin).not.toContain('app.asar')
  })
})

describe('resolveCodex (bundled-first, PATH fallback)', () => {
  it('prefers the bundled binary over a PATH match', () => {
    const spawn = resolveCodex(whichFinds('/usr/local/bin/codex-acp'), () => '/unpacked/codex-acp')
    expect(spawn).toEqual({ command: '/unpacked/codex-acp', args: [], env: {} })
  })

  it('falls back to the PATH-found binary when nothing is bundled', () => {
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
