import { z } from 'zod'

/**
 * Thin fetch client for Zotero 7's local HTTP API (runway step 4). The local API
 * answers keyless at http://localhost:23119/api/users/0/… and mirrors web API v3
 * JSON shapes (verified live 2026-07-09, X-Zotero-Version 9.0.4). Zod parses raw
 * JSON at this boundary; everything downstream is typed.
 *
 * VERIFY-AT-IMPLEMENTATION findings (curl against the live API, this machine):
 *  - Pagination: `start`/`limit` params work; `Total-Results` and `Link`
 *    (rel="next"/"last", carrying `start`) response headers are present.
 *  - Incremental: `?since=<version>` WORKS and filters correctly (since=1000 → 389
 *    results, since=3667 → 1, since=<libraryVersion> → 0). `Last-Modified-Version`
 *    response header carries the current library version — used as the cursor.
 *  - Deleted items: `/deleted?since=` returns 404 ("No endpoint found") on the local API —
 *    NOT available. AND the `since` delta excludes trashed items (verified 2026-07-11), so a
 *    trash operation is invisible to incremental JSON walks. Removal reconciliation instead
 *    diffs the live key set: `fetchAllTopLevelKeys` enumerates NON-TRASHED top-level item keys
 *    via `/items/top?format=keys` (text/plain, newline-delimited, paginated by Total-Results +
 *    start; trash excluded by default). This supersedes the earlier Rebuild-only limitation.
 *  - Attachments: all local attachments are linkMode `imported_file`; the file lives
 *    at <dataDir>/storage/<KEY>/<filename> (path resolution lives in mapping.ts).
 */

const DEFAULT_BASE_URL = 'http://localhost:23119/api/users/0'
const PAGE_LIMIT = 100
const REQUEST_TIMEOUT_MS = 2000
const PROBE_TIMEOUT_MS = 1000

/** A Zotero tag as it appears in item `data.tags`. */
const tagSchema = z.object({ tag: z.string() })

/**
 * Item `data` payload. One permissive schema spanning every itemType we care about
 * (regular items, attachments, annotations) — fields are optional because Zotero
 * only emits the ones relevant to the itemType. Unknown keys are dropped by zod.
 */
export const zoteroItemDataSchema = z.object({
  key: z.string(),
  version: z.number().optional(),
  itemType: z.string(),
  title: z.string().optional(),
  parentItem: z.string().optional(),
  dateAdded: z.string().optional(),
  dateModified: z.string().optional(),
  tags: z.array(tagSchema).optional().default([]),
  collections: z.array(z.string()).optional().default([]),
  // attachment fields
  linkMode: z.string().optional(),
  contentType: z.string().optional(),
  filename: z.string().optional(),
  path: z.string().optional(),
  // annotation fields
  annotationType: z.string().optional(),
  annotationText: z.string().optional(),
  annotationComment: z.string().optional(),
  annotationColor: z.string().optional(),
  annotationPageLabel: z.string().optional(),
  annotationPosition: z.string().optional(),
})
export type ZoteroItemData = z.infer<typeof zoteroItemDataSchema>

export const zoteroItemSchema = z.object({
  key: z.string(),
  version: z.number().optional(),
  data: zoteroItemDataSchema,
})
export type ZoteroItem = z.infer<typeof zoteroItemSchema>

export const zoteroCollectionSchema = z.object({
  key: z.string(),
  data: z.object({
    key: z.string(),
    name: z.string(),
    // Zotero emits `false` for a top-level collection, else the parent key.
    parentCollection: z.union([z.string(), z.literal(false)]).optional(),
  }),
})
export type ZoteroCollection = z.infer<typeof zoteroCollectionSchema>

export interface ItemsPage {
  items: ZoteroItem[]
  totalResults: number
  /** Current library version (Last-Modified-Version header) — the incremental cursor. */
  libraryVersion: number | null
}

export interface ZoteroClientOptions {
  baseUrl?: string
  /** Injected for tests. */
  fetchFn?: typeof fetch
}

function withTimeout(ms: number): { signal: AbortSignal; done: () => void } {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  return { signal: controller.signal, done: () => clearTimeout(timer) }
}

export function createZoteroClient(options: ZoteroClientOptions = {}) {
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL
  const doFetch = options.fetchFn ?? fetch

  async function getJson(path: string, timeoutMs: number): Promise<{ body: unknown; headers: Headers }> {
    const { signal, done } = withTimeout(timeoutMs)
    try {
      const res = await doFetch(`${baseUrl}${path}`, { signal })
      if (!res.ok) throw new Error(`zotero api ${path} → ${res.status}`)
      return { body: await res.json(), headers: res.headers }
    } finally {
      done()
    }
  }

  async function getText(path: string, timeoutMs: number): Promise<{ body: string; headers: Headers }> {
    const { signal, done } = withTimeout(timeoutMs)
    try {
      const res = await doFetch(`${baseUrl}${path}`, { signal })
      if (!res.ok) throw new Error(`zotero api ${path} → ${res.status}`)
      return { body: await res.text(), headers: res.headers }
    } finally {
      done()
    }
  }

  /** 1s probe; never throws (Connector contract). */
  async function checkAvailable(): Promise<boolean> {
    try {
      const { signal, done } = withTimeout(PROBE_TIMEOUT_MS)
      try {
        const res = await doFetch(`${baseUrl}/items?limit=1&format=json`, { signal })
        return res.ok
      } finally {
        done()
      }
    } catch {
      return false
    }
  }

  /** One page of items. `since` omitted on a full walk. */
  async function fetchItemsPage(start: number, since: number | null): Promise<ItemsPage> {
    const sinceParam = since != null ? `&since=${since}` : ''
    const { body, headers } = await getJson(
      `/items?format=json&limit=${PAGE_LIMIT}&start=${start}${sinceParam}`,
      REQUEST_TIMEOUT_MS,
    )
    const items = z.array(zoteroItemSchema).parse(body)
    const total = Number(headers.get('Total-Results'))
    const version = headers.get('Last-Modified-Version')
    return {
      items,
      totalResults: Number.isFinite(total) ? total : items.length,
      libraryVersion: version != null ? Number(version) : null,
    }
  }

  /** Walk every page. `since` limits to items changed after that library version. */
  async function fetchAllItems(since: number | null): Promise<{ items: ZoteroItem[]; libraryVersion: number | null }> {
    const first = await fetchItemsPage(0, since)
    const items = [...first.items]
    for (let start = PAGE_LIMIT; start < first.totalResults; start += PAGE_LIMIT) {
      const page = await fetchItemsPage(start, since)
      items.push(...page.items)
    }
    return { items, libraryVersion: first.libraryVersion }
  }

  /** How many items changed since `version` — cheap early-out probe for incremental scans. */
  async function countChangedSince(version: number): Promise<{ changed: number; libraryVersion: number | null }> {
    const page = await fetchItemsPage(0, version)
    return { changed: page.totalResults, libraryVersion: page.libraryVersion }
  }

  /**
   * Every NON-TRASHED top-level item key — the ground truth for removal reconciliation
   * (index/removals.ts). Uses `/items/top?format=keys` (verified live 2026-07-11, X-Zotero-Version
   * 9.0.4): text/plain, newline-delimited keys, paginated via `Total-Results` + `start`, trashed
   * items EXCLUDED by default (that exclusion is what makes a Zotero trash count as a deletion).
   * `/top` matches the connector's document identity — externalKey is the top-level item key, and
   * standalone attachments (their own key) are top-level too; child attachments/annotations/notes
   * that `/top` may also list are harmless over-inclusion (the sweep only deletes keys it does NOT
   * see, so a superset never over-deletes).
   */
  async function fetchAllTopLevelKeys(): Promise<string[]> {
    const out: string[] = []
    for (let start = 0; ; start += PAGE_LIMIT) {
      const { body, headers } = await getText(
        `/items/top?format=keys&limit=${PAGE_LIMIT}&start=${start}`,
        REQUEST_TIMEOUT_MS,
      )
      const page = body.split('\n').map((k) => k.trim()).filter((k) => k.length > 0)
      out.push(...page)
      const total = Number(headers.get('Total-Results'))
      if (!Number.isFinite(total) || out.length >= total || page.length === 0) break
    }
    return out
  }

  async function fetchCollections(): Promise<ZoteroCollection[]> {
    const out: ZoteroCollection[] = []
    for (let start = 0; ; start += PAGE_LIMIT) {
      const { body, headers } = await getJson(
        `/collections?format=json&limit=${PAGE_LIMIT}&start=${start}`,
        REQUEST_TIMEOUT_MS,
      )
      const page = z.array(zoteroCollectionSchema).parse(body)
      out.push(...page)
      const total = Number(headers.get('Total-Results'))
      if (!Number.isFinite(total) || out.length >= total || page.length === 0) break
    }
    return out
  }

  return { checkAvailable, fetchItemsPage, fetchAllItems, countChangedSince, fetchCollections, fetchAllTopLevelKeys }
}

export type ZoteroClient = ReturnType<typeof createZoteroClient>
