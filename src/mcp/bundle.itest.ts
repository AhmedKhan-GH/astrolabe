import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import {
  StdioClientTransport,
  getDefaultEnvironment,
} from '@modelcontextprotocol/sdk/client/stdio.js'
import { openDb } from '../main/db'
import { createUpsertApi } from '../main/index/upsert'
import { resolveDbPath } from './run'

/**
 * Packaging pin (spec 2026-07-11-acp-dialogue-spec.md §"MCP server packaging" —
 * "THE ONE BUILD-WIRING RISK"): build the BUNDLE the packaged app spawns and drive
 * one real MCP request through it over stdio, exactly as the ACP dialogue manager
 * will (process.execPath + ELECTRON_RUN_AS_NODE=1 + [out/mcp/server.mjs, dbPath]).
 * This runs under `pnpm test:integration` (electron-as-node), so process.execPath
 * is the Electron binary whose ABI better-sqlite3 was built against.
 */

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const bundlePath = join(repoRoot, 'out/mcp/server.mjs')

let dir: string
let dbPath: string

beforeAll(() => {
  // Build the bundle the packaged app ships (idempotent; also proves the script runs).
  execFileSync('node', [join(repoRoot, 'scripts/build-mcp.mjs')], { cwd: repoRoot })
  expect(existsSync(bundlePath)).toBe(true)

  dir = mkdtempSync(join(tmpdir(), 'astrolabe-mcp-bundle-'))
  dbPath = join(dir, 'index.db')

  // Seed via the production write path (mirrors server.itest.ts), then close the writer.
  const writeHandle = openDb(dbPath)
  const upsert = createUpsertApi(writeHandle.db)
  upsert.upsertDocument({
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
}, 60_000)

afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
})

describe('resolveDbPath (argv contract)', () => {
  it('prefers the argv path when present', () => {
    expect(resolveDbPath('/tmp/explicit.db', () => '/fallback.db')).toBe('/tmp/explicit.db')
  })
  it('falls back to the workspace default when argv is missing/empty', () => {
    expect(resolveDbPath(undefined, () => '/fallback.db')).toBe('/fallback.db')
    expect(resolveDbPath('', () => '/fallback.db')).toBe('/fallback.db')
  })
})

describe('built MCP bundle over stdio', () => {
  it('serves search_library against the db passed as argv[2]', async () => {
    // Spawn the built bundle exactly as the dialogue manager will: the Electron
    // binary as node, the bundle, and the db path as argv[2].
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [bundlePath, dbPath],
      env: { ...getDefaultEnvironment(), ELECTRON_RUN_AS_NODE: '1' },
      stderr: 'inherit',
    })
    const client = new Client({ name: 'astrolabe-bundle-itest', version: '0.0.0' })

    try {
      await client.connect(transport) // performs the MCP initialize handshake
      const result = (await client.callTool({
        name: 'search_library',
        arguments: { q: 'precision' },
      })) as { content: { type: string; text: string }[] }

      expect(result.content).toHaveLength(1)
      const hits = JSON.parse(result.content[0]!.text) as { title: string; kind: string }[]
      expect(hits).toHaveLength(1)
      expect(hits[0]!.title).toBe('Probabilistic Machine Learning')
      expect(hits[0]!.kind).toBe('pdf')
    } finally {
      await client.close()
    }
  }, 60_000)
})
