import electron from 'electron'
import { pathToFileURL } from 'node:url'
import { existsSync } from 'node:fs'
import { join, normalize, sep } from 'node:path'
import { eq } from 'drizzle-orm'
import type { Db } from '../db'
import * as s from '../db/schema'

/**
 * The `astro://` scheme (docs/2026-07-10 canvas spec §Serving PDF bytes), two hosts:
 *
 *  - `astro://doc/<instanceId>` — attachment bytes, allowlisted by the index: the
 *    renderer names an instance id, never a path, so pdf.js can only ever fetch files
 *    the index already knows about. Unknown id, null filePath, missing file → 404.
 *  - `astro://app/<path>` — the packaged renderer bundle itself. Chromium refuses
 *    cross-origin fetch FROM a `file://` document to any custom scheme (hard Blink
 *    allowlist — no privilege overrides it), so the packaged window must not load
 *    via loadFile; serving the bundle over this scheme gives the document a custom
 *    origin, and same-scheme cross-host fetches (app → doc) work with ACAO. The dev
 *    server (http origin) can fetch `astro://doc` directly, no app host needed.
 */

// Guarded access to the Electron API object. This module is imported by an integration test
// running under ELECTRON_RUN_AS_NODE, where `electron` resolves to a path string rather than
// the API object (same reason db/index.ts guards its import). protocol/net are only touched at
// registration time — never on the pure `resolveInstanceFile` path the tests exercise.
type ElectronApi = typeof import('electron')
const { protocol, net } = electron as unknown as ElectronApi

export const ASTRO_SCHEME = 'astro'
/** What the packaged window loads instead of loadFile (see module doc). */
export const APP_INDEX_URL = `${ASTRO_SCHEME}://app/index.html`

/**
 * Mark the scheme privileged. MUST run before app.whenReady (Electron requirement) —
 * wired at module load in src/main/index.ts. `supportFetchAPI` is load-bearing:
 * without it renderer fetch() to the scheme is refused outright and pdf.js can never
 * load a document. The scheme stays CORS-enabled (default) and the doc host answers
 * with Access-Control-Allow-Origin — app→doc is a cross-host (cross-origin) fetch.
 */
export function registerAstroProtocolPrivileges(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: ASTRO_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        // Explicit, not defaulted: in practice omitting corsEnabled leaves the scheme
        // off Chromium's CORS-enabled list (proven by probe) and app→doc fetch dies
        // with "Cross origin requests are only supported for protocol schemes: …".
        corsEnabled: true,
        stream: true,
      },
    },
  ])
}

/**
 * The pure allowlist check behind the doc host: an instance id → its on-disk path, or null
 * when it cannot be served (unknown id, or the instance has no filePath). Existence of the
 * file is the handler's concern (it 404s), not this lookup's.
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
 * The pure path guard behind the app host: a URL pathname → an absolute file path inside
 * `rendererDir`, or null when it escapes (traversal) or is empty ('/' → index.html).
 */
export function resolveAppFile(rendererDir: string, pathname: string): string | null {
  const rel = decodeURIComponent(pathname).replace(/^\/+/, '') || 'index.html'
  const resolved = normalize(join(rendererDir, rel))
  return resolved.startsWith(normalize(rendererDir) + sep) ? resolved : null
}

/**
 * Register the streaming handler for both hosts. `getDb` is a thunk so the handler binds
 * to whatever db handle the app opened at boot (protocol.handle must run after app ready).
 * `rendererDir` is the packaged renderer bundle root (out/renderer).
 */
export function registerAstroProtocol(getDb: () => Db, rendererDir: string): void {
  // app → doc is cross-origin (different host), so doc responses — including 404s —
  // must carry ACAO or fetch() hides the result from the renderer.
  const CORS = { 'Access-Control-Allow-Origin': '*' } as const
  protocol.handle(ASTRO_SCHEME, async (request) => {
    const notFound = new Response(null, { status: 404, headers: CORS })
    let host: string
    let pathname: string
    try {
      ;({ host, pathname } = new URL(request.url))
    } catch {
      return notFound
    }

    if (host === 'app') {
      const appFile = resolveAppFile(rendererDir, pathname)
      if (!appFile || !existsSync(appFile)) return notFound
      return net.fetch(pathToFileURL(appFile).toString())
    }

    if (host !== 'doc') return notFound
    const instanceId = Number(decodeURIComponent(pathname.replace(/^\//, '')))
    const filePath = resolveInstanceFile(getDb(), instanceId)
    if (!filePath || !existsSync(filePath)) return notFound
    const file = await net.fetch(pathToFileURL(filePath).toString())
    const headers = new Headers(file.headers)
    headers.set('Access-Control-Allow-Origin', '*')
    return new Response(file.body, { status: file.status, headers })
  })
}
