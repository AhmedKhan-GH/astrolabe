import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

/**
 * Entry point for `pnpm mcp:serve` (runway step 7).
 *
 * better-sqlite3 in this repo is compiled for Electron's native ABI (via
 * electron-builder install-app-deps), so it cannot load under the plain-node
 * process that `tsx` spawns. When we detect we're NOT inside an Electron runtime,
 * we re-exec ourselves through `electron` with ELECTRON_RUN_AS_NODE=1 (the same
 * trick scripts/live-sync.ts and the integration test runner use). stdio is
 * inherited so the child speaks the MCP wire protocol on this process's stdout.
 *
 * Nothing here writes to stdout — that channel belongs to the JSON-RPC transport.
 */

if (process.versions.electron == null) {
  const require = createRequire(import.meta.url)
  // Outside Electron, `require('electron')` resolves to the executable path.
  const electronBinary = require('electron') as string
  const tsxCli = require.resolve('tsx/cli')
  const { spawnSync } = require('node:child_process') as typeof import('node:child_process')
  const result = spawnSync(electronBinary, [tsxCli, fileURLToPath(import.meta.url)], {
    stdio: 'inherit',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  })
  process.exit(result.status ?? 1)
} else {
  const { serve } = await import('./run')
  await serve()
}
