import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { openDb } from '../src/main/db'
import { createUpsertApi } from '../src/main/index/upsert'
import { createAcpManager, nodeChannelFactory } from '../src/main/acp/manager'
import type { McpServerStdio } from '@agentclientprotocol/sdk'
import type { Adapter } from '../src/main/acp/adapters'
import type { AcpUpdateEvent } from '../src/shared/db-ipc'

/**
 * FULL PACKAGED LIVE CANARY (manual gate). Drives the REAL manager against the PACKAGED artifacts:
 * the claude adapter = packaged Electron-as-node + the UNPACKED claude-agent-acp entry, and the MCP
 * mount = packaged Electron-as-node + the UNPACKED server.mjs against a temp seeded db. Proves the
 * whole client → packaged adapter → packaged MCP → sqlite path answers a library question. Needs a
 * real Claude login + network. Run:
 *   ASTROLABE_LIVE_ACP=1 ELECTRON_RUN_AS_NODE=1 electron node_modules/tsx/dist/cli.mjs scripts/packaged-live-acp.ts
 */

const repoRoot = resolve(import.meta.dirname, '..')
const resources = join(repoRoot, 'dist/mac-arm64/Astrolabe.app/Contents/Resources')
const appBin = join(repoRoot, 'dist/mac-arm64/Astrolabe.app/Contents/MacOS/Astrolabe')
const unpacked = join(resources, 'app.asar.unpacked')
const claudeEntry = join(unpacked, 'node_modules/@agentclientprotocol/claude-agent-acp/dist/index.js')
const unpackedServer = join(unpacked, 'out/mcp/server.mjs')
const SEEDED_TITLE = 'Probabilistic Machine Learning'

const packagedClaude: Adapter = {
  key: 'claude',
  label: 'Claude',
  resolve: () => ({ command: appBin, args: [claudeEntry], env: { ELECTRON_RUN_AS_NODE: '1' } }),
}

const packagedMcp = (dbPath: string): McpServerStdio => ({
  name: 'astrolabe-index',
  command: appBin,
  args: [unpackedServer, dbPath],
  env: [{ name: 'ELECTRON_RUN_AS_NODE', value: '1' }],
})

async function main(): Promise<void> {
  if (process.env.ASTROLABE_LIVE_ACP !== '1') {
    console.error('[live] SKIPPED — set ASTROLABE_LIVE_ACP=1 to run (needs a real Claude login).')
    return
  }
  for (const p of [appBin, claudeEntry, unpackedServer]) {
    if (!existsSync(p)) throw new Error(`missing packaged artifact: ${p} (run pnpm package:dir)`)
  }

  const dir = mkdtempSync(join(tmpdir(), 'astrolabe-pkg-live-'))
  mkdirSync(join(dir, '.astrolabe'), { recursive: true })
  const dbPath = join(dir, '.astrolabe', 'index.db')
  const writeHandle = openDb(dbPath)
  createUpsertApi(writeHandle.db).upsertDocument({
    sourceKey: 'zotero',
    externalKey: 'ABC123',
    uri: 'zotero://select/library/items/ABC123',
    title: SEEDED_TITLE,
    kind: 'pdf',
    contentSha256: 'hash-murphy',
    modifiedAt: 1000,
    tags: ['ml', 'textbook'],
    annotations: [],
  })
  writeHandle.close()

  const events: AcpUpdateEvent[] = []
  const manager = createAcpManager({
    channelFactory: nodeChannelFactory,
    mcpServer: () => packagedMcp(dbPath),
    cwd: dir,
    onUpdate: (e) => events.push(e),
    onPermissionRequest: () => {},
    adapters: [packagedClaude],
  })

  try {
    const res = await manager.newSession('claude')
    if ('error' in res) throw new Error(`session/new failed: ${res.error}`)
    console.error('[live] session started:', res.sessionId)
    const ack = manager.prompt(
      res.sessionId,
      `Use the search_library tool to find the document titled "${SEEDED_TITLE}" and answer with its title.`,
    )
    if ('error' in ack) throw new Error(`prompt rejected: ${ack.error}`)

    const deadline = Date.now() + 120_000
    while (Date.now() < deadline) {
      const gotChunk = events.some((e) => e.sessionId === res.sessionId && e.kind === 'chunk')
      const gotEnd = events.some((e) => e.sessionId === res.sessionId && e.kind === 'turn-end')
      const err = events.find((e) => e.kind === 'error') as { reason: string } | undefined
      if (err) throw new Error(`error event: ${err.reason}`)
      if (gotChunk && gotEnd) {
        const text = events
          .filter((e) => e.kind === 'chunk')
          .map((e) => (e as { text?: string }).text ?? '')
          .join('')
        console.error('[live] PASS — packaged claude adapter answered via packaged MCP.')
        console.error('[live] answer excerpt:', text.slice(0, 200))
        return
      }
      await new Promise((r) => setTimeout(r, 250))
    }
    throw new Error('timed out waiting for chunk + turn-end')
  } finally {
    manager.disposeAll()
    rmSync(dir, { recursive: true, force: true })
  }
}

main().catch((err) => {
  console.error('[live] FAIL', String(err))
  process.exit(1)
})
