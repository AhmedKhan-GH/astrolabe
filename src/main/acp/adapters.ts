import { createRequire } from 'node:module'
import { accessSync, constants as fsConstants, statSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import type { McpServerStdio } from '@agentclientprotocol/sdk'
import type { AcpAgentKey } from '../../shared/db-ipc'

/**
 * The agent registry as DATA (2026-07-11-acp-dialogue-spec §Architecture/main). Each adapter
 * knows how to build its subprocess spec and how to probe whether it is runnable. v1 ships two:
 *
 *  - `claude`  — claude-agent-acp, a bundled dependency, spawned through Electron's own node
 *    (ELECTRON_RUN_AS_NODE) pointing at the package's bin entry. Always available in principle
 *    (it's a dependency), resolved robustly via createRequire so it works in dev AND packaged.
 *  - `codex`   — the `codex-acp` binary resolved from PATH (a which-style probe). Present only
 *    if the user has installed it.
 *
 * Nothing here imports electron: `process.execPath` is the running node/electron binary, and the
 * one electron-only value (`app.getAppPath()`) is INJECTED into `mcpServerSpawn`. That keeps this
 * module unit-testable in plain node.
 */

/** A ready-to-spawn subprocess description (command + argv + extra env). */
export interface AcpSpawn {
  command: string
  args: string[]
  env: Record<string, string>
}

/** which-style probe: resolve an executable name to an absolute path, or null if not on PATH.
 *  Injectable so unit tests never touch the real filesystem/PATH. */
export type WhichFn = (bin: string) => string | null

export interface Adapter {
  readonly key: AcpAgentKey
  readonly label: string
  /**
   * Build the spawn spec, or return null when the adapter is not runnable on this machine.
   * `which` is injected for the PATH-resolved adapters so it can be stubbed in tests.
   */
  resolve(which: WhichFn): AcpSpawn | null
}

const require_ = createRequire(import.meta.url)

/** Default PATH scan — no subprocess (a spawned `which`/`where` would be both slower and a TCC
 *  surface). Walks each PATH entry and returns the first executable match. */
export const defaultWhich: WhichFn = (bin) => {
  const path = process.env['PATH'] ?? ''
  const exts = process.platform === 'win32' ? (process.env['PATHEXT'] ?? '.EXE;.CMD;.BAT').split(';') : ['']
  for (const dir of path.split(delimiter)) {
    if (!dir) continue
    for (const ext of exts) {
      const candidate = join(dir, bin + ext)
      try {
        const st = statSync(candidate)
        if (!st.isFile()) continue
        accessSync(candidate, fsConstants.X_OK)
        return candidate
      } catch {
        // not here — keep scanning
      }
    }
  }
  return null
}

/**
 * The claude-agent-acp bin entry, resolved robustly (dev: node_modules on disk; packaged: the
 * unpacked node_modules). Throws only if the dependency is genuinely missing — a build error, not
 * a runtime condition. Exported for the availability probe + spawn.
 */
export function claudeAgentEntry(): string {
  // The package's `exports` map exposes subpaths via "./*", so the bin file resolves directly.
  return require_.resolve('@agentclientprotocol/claude-agent-acp/dist/index.js')
}

/**
 * The INDEX MCP server spawn spec (entry-path CONTRACT — one place, referenced by the parallel
 * MCP-build agent): Electron's node runs the bundled stdio server with the workspace db path as
 * its single argv. `appPath` is injected (it is `app.getAppPath()` at the call site in main) so
 * this file stays electron-free and testable.
 */
export function mcpServerSpawn(appPath: string, dbPath: string): McpServerStdio {
  return {
    name: 'astrolabe-index',
    command: process.execPath,
    args: [join(appPath, 'out', 'mcp', 'server.mjs'), dbPath],
    env: [{ name: 'ELECTRON_RUN_AS_NODE', value: '1' }],
  }
}

/** The v1 adapter registry (data). */
export const adapters: Adapter[] = [
  {
    key: 'claude',
    label: 'Claude',
    resolve() {
      let entry: string
      try {
        entry = claudeAgentEntry()
      } catch {
        return null // dependency not resolvable (should not happen — it's bundled)
      }
      return {
        command: process.execPath,
        args: [entry],
        env: { ELECTRON_RUN_AS_NODE: '1' },
      }
    },
  },
  {
    key: 'codex',
    label: 'Codex',
    resolve(which) {
      const bin = which('codex-acp')
      if (!bin) return null
      return { command: bin, args: [], env: {} }
    },
  },
]
