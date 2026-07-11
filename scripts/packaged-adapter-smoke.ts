import { spawn as spawnProc } from 'node:child_process'
import { existsSync } from 'node:fs'
import { Readable, Writable } from 'node:stream'
import { join, resolve } from 'node:path'
import { client, ndJsonStream, PROTOCOL_VERSION } from '@agentclientprotocol/sdk'

/**
 * PACKAGED-ADAPTER SMOKE (manual verification for the ACP packaging fix). Spawns each adapter EXACTLY
 * as the installed app would — the PACKAGED Electron binary run as node against the UNPACKED
 * claude-agent-acp ESM entry, and the UNPACKED codex-acp NATIVE binary directly — and drives the ACP
 * `initialize` handshake. This proves the process starts and speaks ACP (i.e. the ESM entry + its
 * whole import closure load from app.asar.unpacked, and the native binary execs) WITHOUT needing a
 * Claude/Codex login, network, or a display. A load failure (MODULE_NOT_FOUND, ESM-from-asar, exec
 * error) shows up here as a failed handshake. Run:
 *   ELECTRON_RUN_AS_NODE=1 electron node_modules/tsx/dist/cli.mjs scripts/packaged-adapter-smoke.ts
 */

const repoRoot = resolve(import.meta.dirname, '..')
const resources = join(repoRoot, 'dist/mac-arm64/Astrolabe.app/Contents/Resources')
const appBin = join(repoRoot, 'dist/mac-arm64/Astrolabe.app/Contents/MacOS/Astrolabe')
const unpacked = join(resources, 'app.asar.unpacked')
const claudeEntry = join(unpacked, 'node_modules/@agentclientprotocol/claude-agent-acp/dist/index.js')
const codexBinary = join(unpacked, 'node_modules/@zed-industries/codex-acp-darwin-arm64/bin/codex-acp')

interface Spec {
  label: string
  command: string
  args: string[]
  env: Record<string, string>
}

async function handshake(spec: Spec): Promise<void> {
  if (!existsSync(spec.command)) throw new Error(`missing spawn command: ${spec.command}`)
  const child = spawnProc(spec.command, spec.args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, ...spec.env },
  })
  let stderrTail = ''
  child.stderr?.on('data', (c: Buffer) => {
    stderrTail = (stderrTail + c.toString('utf8')).slice(-2048)
  })
  const stream = ndJsonStream(
    Writable.toWeb(child.stdin!) as WritableStream<Uint8Array>,
    Readable.toWeb(child.stdout!) as ReadableStream<Uint8Array>,
  )
  const app = client({ name: 'astrolabe-pkg-adapter-smoke' })
  const conn = app.connect(stream)
  try {
    const res = await Promise.race([
      conn.agent.request('initialize', {
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
        clientInfo: { name: 'astrolabe', version: '0.0.0' },
      }),
      new Promise((_r, rej) => setTimeout(() => rej(new Error('initialize timed out (20s)')), 20_000)),
    ])
    console.error(`[adapter-smoke] PASS ${spec.label} — initialize replied:`, JSON.stringify(res))
  } catch (err) {
    console.error(`[adapter-smoke] FAIL ${spec.label}:`, String(err))
    if (stderrTail.trim()) console.error(`--- ${spec.label} stderr ---\n${stderrTail.trim()}`)
    throw err
  } finally {
    try {
      child.kill()
    } catch {
      /* already gone */
    }
  }
}

async function main(): Promise<void> {
  await handshake({
    label: 'claude (packaged ELECTRON_RUN_AS_NODE + unpacked ESM entry)',
    command: appBin,
    args: [claudeEntry],
    env: { ELECTRON_RUN_AS_NODE: '1' },
  })
  await handshake({
    label: 'codex (unpacked native binary, spawned directly)',
    command: codexBinary,
    args: [],
    env: {},
  })
  console.error('[adapter-smoke] all adapters started and completed the ACP initialize handshake.')
}

main().catch(() => process.exit(1))
