import { z } from 'zod'

/**
 * Thin fetch client for Zotero 7's local HTTP API, v2: LIBRARY-SCOPED. The
 * local API answers keyless at http://localhost:23119/api and mirrors web API
 * v3 JSON shapes. Zod parses raw JSON at this boundary; everything downstream
 * is typed.
 *
 * v1 verify-at-implementation findings (2026-07-09/11) that still govern:
 *  - Pagination: `start`/`limit` + `Total-Results` header, both JSON and keys.
 *  - Incremental: `?since=<version>` filters; `Last-Modified-Version` header
 *    is the cursor. Trashed items are EXCLUDED from the delta, so deletions
 *    are only observable via the keys diff (`/items/top?format=keys`).
 * v2 verify-at-implementation findings (curl, 2026-07-17, this machine):
 *  - `GET /api/users/0/groups` → the local client's groups, `data.{id,name}`.
 *  - Every endpoint works under `/api/groups/<id>/…` with identical semantics
 *    (verified live: items pagination, Last-Modified-Version, /items/top
 *    keys, collections — group 6356926).
 * The client therefore exposes `library(prefix)` — the same surface bound to
 * '/users/0' or '/groups/<id>' — plus `fetchGroups()` for enumeration.
 */

const DEFAULT_BASE_URL = 'http://localhost:23119/api'
const PAGE_LIMIT = 100
const REQUEST_TIMEOUT_MS = 2000
const PROBE_TIMEOUT_MS = 1000

/** A Zotero tag as it appears in item `data.tags`. */
const tagSchema = z.object({ tag: z.string() })

/**
 * Item `data` payload. One permissive schema spanning every itemType we care
 * about — fields are optional because Zotero only emits the ones relevant to
 * the itemType. Unknown keys are dropped by zod.
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

/** A group as `/users/0/groups` reports it (verified live 2026-07-17). */
export const zoteroGroupSchema = z.object({
  id: z.number(),
  data: z.object({ id: z.number(), name: z.string() }),
})
export type ZoteroGroup = { id: number; name: string }

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
        const res = await doFetch(`${baseUrl}/users/0/items?limit=1&format=json`, { signal })
        return res.ok
      } finally {
        done()
      }
    } catch {
      return false
    }
  }

  /** The local client's group libraries. Empty array when the user has none. */
  async function fetchGroups(): Promise<ZoteroGroup[]> {
    const { body } = await getJson(`/users/0/groups?format=json`, REQUEST_TIMEOUT_MS)
    return z
      .array(zoteroGroupSchema)
      .parse(body)
      .map((g) => ({ id: g.id, name: g.data.name }))
  }

  /** The item/collection/keys surface bound to one library prefix
   *  ('/users/0' or '/groups/<id>') — endpoint semantics are identical. */
  function library(prefix: string) {
    /** One page of items. `since` omitted on a full walk. */
    async function fetchItemsPage(start: number, since: number | null): Promise<ItemsPage> {
      const sinceParam = since != null ? `&since=${since}` : ''
      const { body, headers } = await getJson(
        `${prefix}/items?format=json&limit=${PAGE_LIMIT}&start=${start}${sinceParam}`,
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
    async function fetchAllItems(
      since: number | null,
    ): Promise<{ items: ZoteroItem[]; libraryVersion: number | null }> {
      const first = await fetchItemsPage(0, since)
      const items = [...first.items]
      for (let start = PAGE_LIMIT; start < first.totalResults; start += PAGE_LIMIT) {
        const page = await fetchItemsPage(start, since)
        items.push(...page.items)
      }
      return { items, libraryVersion: first.libraryVersion }
    }

    /** How many items changed since `version` — cheap early-out probe for incremental scans. */
    async function countChangedSince(
      version: number,
    ): Promise<{ changed: number; libraryVersion: number | null }> {
      const page = await fetchItemsPage(0, version)
      return { changed: page.totalResults, libraryVersion: page.libraryVersion }
    }

    /**
     * Every NON-TRASHED top-level item key — the ground truth for the removal
     * sweep. `/items/top?format=keys`: text/plain, newline-delimited,
     * paginated via Total-Results + start, trash excluded by default (that
     * exclusion is what makes a Zotero trash count as a deletion). Top-level
     * over-inclusion is harmless — the sweep only deletes keys it does NOT see.
     */
    async function fetchAllTopLevelKeys(): Promise<string[]> {
      const out: string[] = []
      for (let start = 0; ; start += PAGE_LIMIT) {
        const { body, headers } = await getText(
          `${prefix}/items/top?format=keys&limit=${PAGE_LIMIT}&start=${start}`,
          REQUEST_TIMEOUT_MS,
        )
        const page = body
          .split('\n')
          .map((k) => k.trim())
          .filter((k) => k.length > 0)
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
          `${prefix}/collections?format=json&limit=${PAGE_LIMIT}&start=${start}`,
          REQUEST_TIMEOUT_MS,
        )
        const page = z.array(zoteroCollectionSchema).parse(body)
        out.push(...page)
        const total = Number(headers.get('Total-Results'))
        if (!Number.isFinite(total) || out.length >= total || page.length === 0) break
      }
      return out
    }

    return { fetchItemsPage, fetchAllItems, countChangedSince, fetchAllTopLevelKeys, fetchCollections }
  }

  return { checkAvailable, fetchGroups, library }
}

export type ZoteroClient = ReturnType<typeof createZoteroClient>
export type ZoteroLibraryApi = ReturnType<ZoteroClient['library']>
