import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

// esbuild is a transitive dep (via vite), so it isn't at the top of node_modules
// under pnpm. Resolve it through vite — the same version electron-vite uses.
const require = createRequire(import.meta.url)
const esbuildPath = require.resolve('esbuild', { paths: [require.resolve('vite')] })
const { build } = require(esbuildPath)

/**
 * Bundle the stdio MCP server (src/mcp/run.ts) into a single ESM file the
 * PACKAGED Electron app can spawn without tsx. The ACP dialogue manager launches
 * it as `process.execPath` + ELECTRON_RUN_AS_NODE=1 + [out/mcp/server.mjs, dbPath]
 * (spec 2026-07-11-acp-dialogue-spec.md §"MCP server packaging").
 *
 * better-sqlite3 is a native addon compiled for Electron's ABI — it CANNOT be
 * bundled; it must resolve from node_modules at runtime. This mirrors what
 * electron-vite's externalizeDepsPlugin does for the main/preload bundles. The
 * MCP SDK, drizzle-orm, and zod are pure JS and ARE bundled in.
 */

const entry = fileURLToPath(new URL('../src/mcp/run.ts', import.meta.url))
const outfile = fileURLToPath(new URL('../out/mcp/server.mjs', import.meta.url))

await build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  // Native addon — stays external, resolved from node_modules at runtime.
  // electron-builder ships it (prod dependency) with its .node unpacked from the asar.
  external: ['better-sqlite3'],
  // Some bundled-in CJS deps expect a CommonJS `require`/`__dirname` at runtime;
  // provide the ESM shims so they keep working inside the .mjs output.
  banner: {
    js: [
      "import { createRequire as __astroCreateRequire } from 'node:module'",
      "import { fileURLToPath as __astroFileURLToPath } from 'node:url'",
      "import { dirname as __astroDirname } from 'node:path'",
      'const require = __astroCreateRequire(import.meta.url)',
      'const __filename = __astroFileURLToPath(import.meta.url)',
      'const __dirname = __astroDirname(__filename)',
    ].join('\n'),
  },
  logLevel: 'info',
})

console.error(`[build-mcp] wrote ${outfile}`)
