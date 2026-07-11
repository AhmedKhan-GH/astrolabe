import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { openDb } from '../db'
import { createUpsertApi } from '../index/upsert'
import { createAcpManager, nodeChannelFactory, type AcpManager } from './manager'
import { mcpServerSpawn } from './adapters'
import type { AcpUpdateEvent } from '../../shared/db-ipc'

/**
 * LIVE CANARY (manual gate — spec §"Live (manual gate)"): spawns the REAL claude-agent-acp adapter,
 * mounts the REAL built index MCP server against a temp seeded workspace db, and drives one library
 * question end-to-end. This is the adapter-upgrade tripwire: it proves the whole client → adapter →
 * MCP → sqlite path answers with library content.
 *
 * Gated behind ASTROLABE_LIVE_ACP=1 (needs a real Claude login + network), so it is SKIPPED in
 * normal runs — never a failure. Turn it on with `ASTROLABE_LIVE_ACP=1 pnpm test:integration`.
 */

const LIVE = process.env.ASTROLABE_LIVE_ACP === '1'
const SEEDED_TITLE = 'Probabilistic Machine Learning'
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const bundlePath = join(repoRoot, 'out/mcp/server.mjs')

// Always-on guard: the canary must stay OFF by default — flipping it on unintentionally would spawn
// a real adapter + hit the network in ordinary CI. This asserts the gate reflects the environment.
describe('live ACP canary — gate', () => {
  it('runs only under ASTROLABE_LIVE_ACP=1 (skipped by default)', () => {
    expect(LIVE).toBe(process.env.ASTROLABE_LIVE_ACP === '1')
    if (process.env.ASTROLABE_LIVE_ACP !== '1') expect(LIVE).toBe(false)
  })
})

describe.skipIf(!LIVE)('live ACP canary — real claude adapter answers a library question', () => {
  let dir: string
  let dbPath: string
  let manager: AcpManager

  beforeAll(() => {
    // Build the bundle the packaged app spawns (idempotent), exactly like bundle.itest.ts.
    execFileSync('node', [join(repoRoot, 'scripts/build-mcp.mjs')], { cwd: repoRoot })
    expect(existsSync(bundlePath)).toBe(true)

    dir = mkdtempSync(join(tmpdir(), 'astrolabe-live-acp-'))
    mkdirSync(join(dir, '.astrolabe'), { recursive: true })
    dbPath = join(dir, '.astrolabe', 'index.db')

    // Seed one distinctive document via the production write path.
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
  }, 120_000)

  afterAll(() => {
    manager?.disposeAll()
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  it('streams ≥1 chunk and a turn-end for a search_library question', async () => {
    const events: AcpUpdateEvent[] = []
    manager = createAcpManager({
      channelFactory: nodeChannelFactory,
      mcpServer: () => mcpServerSpawn(repoRoot, dbPath),
      cwd: dir,
      onUpdate: (e) => events.push(e),
      onPermissionRequest: () => {},
    })

    const res = await manager.newSession('claude')
    expect('sessionId' in res).toBe(true)
    const { sessionId } = res as { sessionId: string }

    const ack = manager.prompt(
      sessionId,
      `Use the search_library tool to find the document titled "${SEEDED_TITLE}" and answer with its title.`,
    )
    expect(ack).toEqual({ ok: true })

    // Generous window: a real model turn with a tool round-trip.
    await vi.waitFor(
      () => {
        expect(events.some((e) => e.sessionId === sessionId && e.kind === 'chunk')).toBe(true)
        expect(events.some((e) => e.sessionId === sessionId && e.kind === 'turn-end')).toBe(true)
      },
      { timeout: 120_000, interval: 250 },
    )
  }, 180_000)
})
