import { createRequire } from 'node:module'
import { accessSync, constants as fsConstants, statSync } from 'node:fs'
import { homedir } from 'node:os'
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
 *  - `codex`   — `@agentclientprotocol/codex-acp`, a bundled dependency too (an ESM entry — NOT a
 *    native binary anymore; it starts the Codex App Server carried by its own `@openai/codex`
 *    dependency). Spawned EXACTLY like claude: Electron's node against the package's `dist/index.js`,
 *    resolved robustly via createRequire. A user-managed `codex-acp` on PATH is a trivial fallback
 *    for a self-installed version.
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

/**
 * Rewrite a path that lands INSIDE `app.asar` to its unpacked twin under `app.asar.unpacked`.
 * electron-builder copies every `asarUnpack` match out to that sibling directory; Electron's node
 * cannot `import` an ESM entry — nor exec a native binary — from inside the asar archive, so every
 * spawn target (and any cwd) that resolves into the asar must be redirected here first. A no-op in
 * dev (there is no `app.asar` segment on disk), and idempotent (no `app.asar.unpacked` → asar).
 * Matches `app.asar` only as a full path segment, on either separator (POSIX + Windows).
 */
export function unpackedPath(p: string): string {
  return p.replace(/([\\/])app\.asar([\\/])/, '$1app.asar.unpacked$2')
}

/**
 * Standard user bin dirs a GUI/launchd-spawned macOS app does NOT inherit on PATH (launchd hands
 * apps a minimal PATH). Appended to the PATH scan so a user-managed `codex-acp` in one of these
 * places is still found as a fallback to the bundled binary.
 */
const extraPathDirs = (): string[] => {
  const home = homedir()
  return [join(home, '.local', 'bin'), '/opt/homebrew/bin', join(home, '.cargo', 'bin'), '/usr/local/bin']
}

/** Default PATH scan — no subprocess (a spawned `which`/`where` would be both slower and a TCC
 *  surface). Walks each PATH entry (plus the standard user dirs launchd strips) and returns the
 *  first executable match. */
export const defaultWhich: WhichFn = (bin) => {
  const path = process.env['PATH'] ?? ''
  const exts = process.platform === 'win32' ? (process.env['PATHEXT'] ?? '.EXE;.CMD;.BAT').split(';') : ['']
  const dirs = [...path.split(delimiter), ...extraPathDirs()]
  for (const dir of dirs) {
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
  // Escaped out of the asar: it's an ESM entry Electron's node cannot import from inside app.asar.
  return unpackedPath(require_.resolve('@agentclientprotocol/claude-agent-acp/dist/index.js'))
}

/**
 * The @agentclientprotocol/codex-acp bin entry, resolved robustly (dev: node_modules on disk;
 * packaged: the unpacked node_modules). The twin of `claudeAgentEntry` — codex-acp is now a plain
 * bundled ESM entry (`dist/index.js`, per its package `bin`), NOT a native binary. It starts the
 * Codex App Server by spawning its own `@openai/codex` dependency's native binary at runtime, so
 * that whole closure must be unpacked (electron-builder.yml). Escaped out of the asar: Electron's
 * node cannot import an ESM entry from inside app.asar. Throws only if the dependency is genuinely
 * missing — a build error, not a runtime condition.
 */
export function codexAgentEntry(): string {
  return unpackedPath(require_.resolve('@agentclientprotocol/codex-acp/dist/index.js'))
}

/**
 * Codex spawn resolution: prefer the BUNDLED codex-acp ESM entry (spawned through Electron's node,
 * exactly like claude — works out of the box), and fall back to a user-managed `codex-acp` on PATH
 * (a self-installed version). `entry` is injected (returns the resolved entry, or null when the
 * dependency is unresolvable) so the bundled-vs-fallback branch is unit-testable.
 */
export function resolveCodex(which: WhichFn, entry: () => string | null): AcpSpawn | null {
  const e = entry()
  if (e) return { command: process.execPath, args: [e], env: { ELECTRON_RUN_AS_NODE: '1' } }
  const path = which('codex-acp')
  if (!path) return null
  return { command: path, args: [], env: {} }
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
    // The server entry is bundled ESM (server.mjs); `appPath` is app.getAppPath() which is the
    // `…/app.asar` root when packaged, so escape the entry out to app.asar.unpacked.
    command: process.execPath,
    args: [unpackedPath(join(appPath, 'out', 'mcp', 'server.mjs')), dbPath],
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
      return resolveCodex(which, () => {
        try {
          return codexAgentEntry()
        } catch {
          return null // dependency not resolvable — try a user-managed codex-acp on PATH
        }
      })
    },
  },
]
