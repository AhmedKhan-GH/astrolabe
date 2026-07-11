import { spawn as spawnProc } from 'node:child_process'
import { existsSync } from 'node:fs'
import { Readable, Writable } from 'node:stream'
import { join, resolve } from 'node:path'
import { client, ndJsonStream, PROTOCOL_VERSION } from '@agentclientprotocol/sdk'

/**
 * PACKAGED-ADAPTER SMOKE (manual verification for the ACP packaging fix). Spawns each adapter EXACTLY
 * as the installed app would — the PACKAGED Electron binary run as node against the UNPACKED
 * claude-agent-acp AND codex-acp ESM entries — and drives the ACP `initialize` handshake. This proves
 * each process starts and speaks ACP (i.e. the ESM entry + its whole import closure load from
 * app.asar.unpacked). For codex, `initialize` also starts the Codex App Server — the native
 * @openai/codex binary under app.asar.unpacked/node_modules/@openai — so a green codex handshake ALSO
 * proves that native binary execs. All WITHOUT needing a Claude/Codex login, network, or a display. A
 * load failure (MODULE_NOT_FOUND, ESM-from-asar, exec error) shows up here as a failed handshake. The
 * initialize reply carries `agentInfo.version`, which we print as the proof of the version bump
 * (codex-acp 0.16.0 → 1.1.x, i.e. the newer bundled Codex → current model list). Run:
 *   ELECTRON_RUN_AS_NODE=1 electron node_modules/tsx/dist/cli.mjs scripts/packaged-adapter-smoke.ts
 */

const repoRoot = resolve(import.meta.dirname, '..')
const resources = join(repoRoot, 'dist/mac-arm64/Astrolabe.app/Contents/Resources')
const appBin = join(repoRoot, 'dist/mac-arm64/Astrolabe.app/Contents/MacOS/Astrolabe')
const unpacked = join(resources, 'app.asar.unpacked')
const claudeEntry = join(unpacked, 'node_modules/@agentclientprotocol/claude-agent-acp/dist/index.js')
const codexEntry = join(unpacked, 'node_modules/@agentclientprotocol/codex-acp/dist/index.js')

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
    const info = (res as { agentInfo?: { name?: string; version?: string } }).agentInfo
    const versionTag = info?.version ? ` (agent ${info.name ?? '?'} v${info.version})` : ''
    console.error(`[adapter-smoke] PASS ${spec.label}${versionTag} — initialize replied:`, JSON.stringify(res))
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
    label: 'codex (packaged ELECTRON_RUN_AS_NODE + unpacked ESM entry → Codex App Server)',
    command: appBin,
    args: [codexEntry],
    env: { ELECTRON_RUN_AS_NODE: '1' },
  })
  console.error('[adapter-smoke] all adapters started and completed the ACP initialize handshake.')
}

main().catch(() => process.exit(1))
