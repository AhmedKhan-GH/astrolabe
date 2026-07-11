import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js'
import { openDb } from '../src/main/db'
import { createUpsertApi } from '../src/main/index/upsert'

/**
 * PACKAGED-SPAWN SMOKE (manual verification for the ACP packaging fix). Reproduces the EXACT spawn
 * the installed app performs for session/new's MCP mount: the PACKAGED Electron binary run as node
 * (ELECTRON_RUN_AS_NODE=1) against the UNPACKED out/mcp/server.mjs + a temp seeded db, driving one
 * real MCP request over stdio. Proves the ESM-from-asar fix (server loads) AND that better-sqlite3's
 * native addon loads inside the packaged binary. Run:
 *   ELECTRON_RUN_AS_NODE=1 electron node_modules/tsx/dist/cli.mjs scripts/packaged-acp-smoke.ts
 */

const repoRoot = resolve(import.meta.dirname, '..')
const appBin = join(repoRoot, 'dist/mac-arm64/Astrolabe.app/Contents/MacOS/Astrolabe')
const unpackedServer = join(
  repoRoot,
  'dist/mac-arm64/Astrolabe.app/Contents/Resources/app.asar.unpacked/out/mcp/server.mjs',
)

async function main(): Promise<void> {
  if (!existsSync(appBin)) throw new Error(`packaged binary missing: ${appBin} (run pnpm package:dir)`)
  if (!existsSync(unpackedServer)) throw new Error(`unpacked server missing: ${unpackedServer}`)

  const dir = mkdtempSync(join(tmpdir(), 'astrolabe-pkg-smoke-'))
  mkdirSync(join(dir, '.astrolabe'), { recursive: true })
  const dbPath = join(dir, '.astrolabe', 'index.db')

  const writeHandle = openDb(dbPath)
  createUpsertApi(writeHandle.db).upsertDocument({
    sourceKey: 'zotero',
    externalKey: 'ABC123',
    uri: 'zotero://select/library/items/ABC123',
    title: 'Probabilistic Machine Learning',
    kind: 'pdf',
    contentSha256: 'hash-murphy',
    modifiedAt: 1000,
    tags: ['ml', 'textbook'],
    annotations: [
      {
        externalKey: 'ANN1',
        type: 'highlight',
        text: 'precision represents the probability that a positive test is a true positive',
        pageLabel: '148',
        color: '#ffd400',
        positionJson: null,
        modifiedAt: 1000,
      },
    ],
  })
  writeHandle.close()

  // The exact spawn the installed app performs: packaged Electron-as-node + unpacked server + db.
  const transport = new StdioClientTransport({
    command: appBin,
    args: [unpackedServer, dbPath],
    env: { ...getDefaultEnvironment(), ELECTRON_RUN_AS_NODE: '1' },
    stderr: 'inherit',
  })
  const client = new Client({ name: 'astrolabe-pkg-smoke', version: '0.0.0' })

  try {
    await client.connect(transport)
    const tools = (await client.listTools()).tools.map((t) => t.name)
    console.error('[smoke] tools:', tools.join(', '))
    const result = (await client.callTool({ name: 'search_library', arguments: { q: 'precision' } })) as {
      content: { type: string; text: string }[]
    }
    const hits = JSON.parse(result.content[0]!.text) as { title: string; kind: string }[]
    if (hits.length !== 1 || hits[0]!.title !== 'Probabilistic Machine Learning') {
      throw new Error(`unexpected search result: ${JSON.stringify(hits)}`)
    }
    console.error('[smoke] PASS — packaged binary served search_library:', hits[0]!.title, `(${hits[0]!.kind})`)
  } finally {
    await client.close()
    rmSync(dir, { recursive: true, force: true })
  }
}

main().catch((err) => {
  console.error('[smoke] FAIL', err)
  process.exit(1)
})
