import electron from 'electron'
import { pathToFileURL } from 'node:url'
import { existsSync } from 'node:fs'
import { eq } from 'drizzle-orm'
import type { Db } from '../db'
import * as s from '../db/schema'

/**
 * Serving PDF (and other attachment) bytes to the renderer (docs/2026-07-10 canvas spec
 * §Serving PDF bytes). A custom `astro-doc://instance/<instanceId>` scheme, allowlisted by
 * the index — the renderer names an instance id, never a path, so pdf.js can only ever fetch
 * files the index already knows about. Unknown id, null filePath, or missing file → 404.
 */

// Guarded access to the Electron API object. This module is imported by an integration test
// running under ELECTRON_RUN_AS_NODE, where `electron` resolves to a path string rather than
// the API object (same reason db/index.ts guards its import). protocol/net are only touched at
// registration time — never on the pure `resolveInstanceFile` path the tests exercise.
type ElectronApi = typeof import('electron')
const { protocol, net } = electron as unknown as ElectronApi

export const DOC_PROTOCOL_SCHEME = 'astro-doc'

/**
 * Mark the scheme privileged with a streaming response body. MUST run before app.whenReady
 * (Electron requirement) — wired at module load in src/main/index.ts.
 */
export function registerDocProtocolPrivileges(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: DOC_PROTOCOL_SCHEME, privileges: { stream: true } },
  ])
}

/**
 * The pure allowlist check behind the handler: an instance id → its on-disk path, or null when
 * it cannot be served (unknown id, or the instance has no filePath). Existence of the file is
 * the handler's concern (it 404s), not this lookup's.
 */
export function resolveInstanceFile(db: Db, instanceId: number): string | null {
  if (!Number.isInteger(instanceId) || instanceId <= 0) return null
  const row = db
    .select({ filePath: s.documentInstances.filePath })
    .from(s.documentInstances)
    .where(eq(s.documentInstances.id, instanceId))
    .get()
  return row?.filePath ?? null
}

/**
 * Register the streaming handler. `getDb` is a thunk so the handler binds to whatever db handle
 * the app opened at boot (protocol.handle must run after app is ready).
 */
export function registerDocProtocol(getDb: () => Db): void {
  protocol.handle(DOC_PROTOCOL_SCHEME, (request) => {
    const notFound = new Response(null, { status: 404 })
    let instanceId: number
    try {
      const { host, pathname } = new URL(request.url)
      if (host !== 'instance') return notFound
      instanceId = Number(decodeURIComponent(pathname.replace(/^\//, '')))
    } catch {
      return notFound
    }
    const filePath = resolveInstanceFile(getDb(), instanceId)
    if (!filePath || !existsSync(filePath)) return notFound
    return net.fetch(pathToFileURL(filePath).toString())
  })
}
