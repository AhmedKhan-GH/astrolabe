import { z } from 'zod'
import { moduleLogger } from '../../lib/logger'

/**
 * Thin fetch client for Eagle's local HTTP API. Eagle 4.0.0 answers TOKENLESS on
 * http://localhost:41595/api/… when the app is running (connection refused otherwise)
 * — `token` is plumbed through for setups that require it but is unused by default.
 * Every call is zod-validated at this network boundary and bounded by a short timeout
 * so a hung Eagle degrades the source, never blocks the app.
 *
 * Eagle exposes exactly ONE open library at a time (there is no enumeration endpoint):
 * `/library/info` names the currently-open library, and every item/folder call reads
 * that library. So this connector returns a SINGLE LibraryScanResult per scan, keyed by
 * the library PATH (spine spec v2 §1) — switching Eagle's open library is a library
 * SWITCH (the previous one goes dormant), never a mass deletion (spec §2).
 *
 * VERIFIED live 2026-07-09 (Eagle 4.0.0):
 *  - envelope: { status: 'success' | 'error', data: ... }.
 *  - /application/info → data.version.
 *  - /library/info → data.library.path (+ .name) and data.folders (nested tree).
 *  - /item/list?limit=N&offset=P → data: item[]. **offset is a PAGE index, not a row
 *    offset**: limit=2&offset=0 → rows 0-1, offset=1 → rows 2-3 (verified empirically).
 *    No server-side mtime filter param exists → full metadata walk each scan, watermark
 *    client-side on item.modificationTime.
 *  - /folder/list → data: folder[] (same nested `children` shape as library-info.folders).
 */
const log = moduleLogger('connector.eagle')

const DEFAULT_BASE = 'http://localhost:41595/api'
const DEFAULT_TIMEOUT_MS = 2000

const envelope = <T extends z.ZodTypeAny>(data: T) =>
  z.object({ status: z.string(), data })

const applicationInfoSchema = envelope(z.object({ version: z.string() }).loose())

const rawFolderArray = z.array(z.unknown())
const libraryInfoSchema = envelope(
  z.object({
    library: z.object({ path: z.string(), name: z.string().optional() }),
    folders: rawFolderArray.default([]),
  }).loose(),
)

const itemListSchema = envelope(z.array(z.unknown()))

export interface EagleClientOptions {
  baseUrl?: string
  token?: string
  timeoutMs?: number
}

export interface EagleLibraryInfo {
  /** Absolute path of the currently-open library — its stable identity (spec §1). */
  path: string
  /** Human name of the library, when Eagle reports one (v2: drives displayName). */
  name?: string
  folders: unknown[]
}

export interface EagleClient {
  /** Availability probe; caller supplies a short timeout (never throws is the caller's job). */
  applicationInfo(timeoutMs?: number): Promise<{ version: string }>
  libraryInfo(): Promise<EagleLibraryInfo>
  /** One page. `page` maps to the API's `offset` (page index); `limit` is page size. */
  itemList(params: { limit: number; page: number }): Promise<unknown[]>
  folderList(): Promise<unknown[]>
}

export function createEagleClient(opts: EagleClientOptions = {}): EagleClient {
  const base = opts.baseUrl ?? DEFAULT_BASE
  const defaultTimeout = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS

  async function request<T>(path: string, schema: z.ZodType<T>, timeoutMs: number): Promise<T> {
    const url = new URL(base + path)
    if (opts.token) url.searchParams.set('token', opts.token)
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
    if (!res.ok) throw new Error(`eagle ${path} http ${res.status}`)
    const json: unknown = await res.json()
    const parsed = schema.parse(json)
    const status = (parsed as { status: string }).status
    if (status !== 'success') throw new Error(`eagle ${path} status ${status}`)
    return parsed
  }

  return {
    async applicationInfo(timeoutMs = defaultTimeout) {
      const { data } = await request('/application/info', applicationInfoSchema, timeoutMs)
      return { version: data.version }
    },
    async libraryInfo() {
      const { data } = await request('/library/info', libraryInfoSchema, defaultTimeout)
      log.debug({ path: data.library.path }, 'eagle library resolved')
      return { path: data.library.path, name: data.library.name, folders: data.folders }
    },
    async itemList({ limit, page }) {
      const { data } = await request(
        `/item/list?limit=${limit}&offset=${page}`,
        itemListSchema,
        defaultTimeout,
      )
      return data
    },
    async folderList() {
      const { data } = await request('/folder/list', itemListSchema, defaultTimeout)
      return data
    },
  }
}
