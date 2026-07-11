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
 *  - `codex`   — the `codex-acp` native binary. Bundled: `@zed-industries/codex-acp` ships a
 *    per-platform native executable (unpacked from the asar, spawned directly), so Codex works out
 *    of the box; a user-managed `codex-acp` on PATH is the fallback for a newer self-installed
 *    version.
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

/** node platform/arch → the @zed-industries/codex-acp platform-binary package (mirrors the npm
 *  package's own shim). Absent entries mean "no bundled binary for this host". */
const CODEX_BINARY_PKG: Partial<Record<NodeJS.Platform, Partial<Record<string, string>>>> = {
  darwin: { arm64: 'codex-acp-darwin-arm64', x64: 'codex-acp-darwin-x64' },
  linux: { arm64: 'codex-acp-linux-arm64', x64: 'codex-acp-linux-x64' },
  win32: { arm64: 'codex-acp-win32-arm64', x64: 'codex-acp-win32-x64' },
}

/**
 * The BUNDLED codex-acp native binary for this host, or null if the package/binary is unavailable
 * (e.g. an unsupported platform, or the optionalDependency was not installed). The npm package
 * ships a node shim (`bin/codex-acp.js`) whose sole job is to locate + exec the platform binary via
 * `import.meta.resolve`; we deliberately SKIP the shim — inside the packaged app its resolve would
 * point back into the asar — and resolve the native binary ourselves, then escape it out of the
 * asar (a native executable can never exec from inside app.asar). Spawned directly, no shim, no
 * extra process layer: the binary speaks ACP over stdio itself.
 */
export function codexBundledBinary(): string | null {
  const pkg = CODEX_BINARY_PKG[process.platform]?.[process.arch]
  if (!pkg) return null
  let shim: string
  try {
    shim = require_.resolve('@zed-industries/codex-acp/bin/codex-acp.js')
  } catch {
    return null // package not installed
  }
  const binaryName = process.platform === 'win32' ? 'codex-acp.exe' : 'codex-acp'
  try {
    // Resolve the platform-binary package relative to the shim (its optionalDependency lives in
    // the shim package's own subtree under pnpm), then rewrite into app.asar.unpacked.
    const resolved = createRequire(shim).resolve(`@zed-industries/${pkg}/bin/${binaryName}`)
    return unpackedPath(resolved)
  } catch {
    return null // optional platform dependency not installed
  }
}

/**
 * Codex spawn resolution: prefer the BUNDLED native binary (works out of the box), and fall back to
 * a user-managed `codex-acp` on PATH (a newer self-installed version). `bundled` is injected so the
 * bundled-vs-fallback branch is unit-testable without the real package layout.
 */
export function resolveCodex(which: WhichFn, bundled: () => string | null): AcpSpawn | null {
  const binary = bundled()
  if (binary) return { command: binary, args: [], env: {} }
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
      return resolveCodex(which, codexBundledBinary)
    },
  },
]
