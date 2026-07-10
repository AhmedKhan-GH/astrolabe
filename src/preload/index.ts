import { contextBridge, ipcRenderer } from 'electron'
import {
  DB_CHANNEL,
  INDEX_BROWSE_CHANNEL,
  INDEX_NAV_CHANNEL,
  INDEX_REBUILD_CHANNEL,
  INDEX_SOURCES_CHANNEL,
  INDEX_STATS_CHANNEL,
  INDEX_SEARCH_CHANNEL,
  INDEX_SYNC_CHANNEL,
  SYSTEM_OPEN_CHANNEL,
  SYSTEM_REQUEST_ACCESS_CHANNEL,
  VCOLLECTIONS_ADD_MEMBERS_CHANNEL,
  VCOLLECTIONS_CREATE_CHANNEL,
  VCOLLECTIONS_DELETE_CHANNEL,
  VCOLLECTIONS_LIST_CHANNEL,
  VCOLLECTIONS_REMOVE_MEMBERS_CHANNEL,
  VIEWS_DELETE_CHANNEL,
  VIEWS_LIST_CHANNEL,
  VIEWS_SAVE_CHANNEL,
} from '../shared/db-ipc'
import type { Meta, NewMeta } from '../main/db/schema'
import type {
  BrowsePage,
  BrowseRequest,
  IndexStats,
  NavData,
  SearchHit,
  SearchRequest,
  SourceSummary,
} from '../main/index/queries'
import type { SyncReport } from '../main/index/sync'
import type { AccessProbeResult } from '../main/system/access'
import type { SourceKey } from '../main/connectors/types'
import type { SavedView, SaveViewRequest } from '../main/lib/views'
import type { VCollectionSummary } from '../main/lib/vcollections'

/**
 * The single, explicit IPC surface exposed to the renderer — an allowlist, never a
 * blanket `ipcRenderer` passthrough. The launch smoke asserts these exact keys.
 *
 * `createTableClient` is the salvaged typed table-client (docs/01 salvage manifest):
 * Drizzle's $infer types flow schema → IPC → renderer with zero duplication.
 */
function createTableClient<TSelect, TInsert extends Record<string, unknown>>(table: string) {
  return {
    getAll: (): Promise<TSelect[]> => ipcRenderer.invoke(DB_CHANNEL, { table, op: 'getAll' }),
    getById: (id: number): Promise<TSelect | null> =>
      ipcRenderer.invoke(DB_CHANNEL, { table, op: 'getById', id }),
    create: (values: TInsert): Promise<TSelect> =>
      ipcRenderer.invoke(DB_CHANNEL, { table, op: 'create', values }),
    update: (id: number, values: Partial<TInsert>): Promise<TSelect | null> =>
      ipcRenderer.invoke(DB_CHANNEL, { table, op: 'update', id, values }),
    remove: (id: number): Promise<number> =>
      ipcRenderer.invoke(DB_CHANNEL, { table, op: 'delete', id }),
  }
}

const api = {
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
  db: {
    meta: createTableClient<Meta, NewMeta>('meta'),
  },
  index: {
    search: (
      q: string,
      limit?: number,
      filters?: Omit<Partial<SearchRequest>, 'q' | 'limit'>,
    ): Promise<SearchHit[]> =>
      ipcRenderer.invoke(INDEX_SEARCH_CHANNEL, { q, ...(limit ? { limit } : {}), ...filters }),
    browse: (req: Partial<BrowseRequest>): Promise<BrowsePage> =>
      ipcRenderer.invoke(INDEX_BROWSE_CHANNEL, req),
    nav: (): Promise<NavData> => ipcRenderer.invoke(INDEX_NAV_CHANNEL),
    sync: (): Promise<SyncReport[]> => ipcRenderer.invoke(INDEX_SYNC_CHANNEL),
    rebuild: (): Promise<SyncReport[]> => ipcRenderer.invoke(INDEX_REBUILD_CHANNEL),
    sources: (): Promise<SourceSummary[]> => ipcRenderer.invoke(INDEX_SOURCES_CHANNEL),
    stats: (): Promise<IndexStats> => ipcRenderer.invoke(INDEX_STATS_CHANNEL),
  },
  views: {
    list: (): Promise<SavedView[]> => ipcRenderer.invoke(VIEWS_LIST_CHANNEL),
    save: (req: SaveViewRequest): Promise<SavedView> => ipcRenderer.invoke(VIEWS_SAVE_CHANNEL, req),
    remove: (slug: string): Promise<boolean> =>
      ipcRenderer.invoke(VIEWS_DELETE_CHANNEL, { slug }),
  },
  collections: {
    list: (): Promise<VCollectionSummary[]> => ipcRenderer.invoke(VCOLLECTIONS_LIST_CHANNEL),
    create: (name: string): Promise<VCollectionSummary> =>
      ipcRenderer.invoke(VCOLLECTIONS_CREATE_CHANNEL, { name }),
    remove: (slug: string): Promise<boolean> =>
      ipcRenderer.invoke(VCOLLECTIONS_DELETE_CHANNEL, { slug }),
    addMembers: (slug: string, documentIds: number[]): Promise<VCollectionSummary> =>
      ipcRenderer.invoke(VCOLLECTIONS_ADD_MEMBERS_CHANNEL, { slug, documentIds }),
    removeMembers: (slug: string, documentIds: number[]): Promise<VCollectionSummary> =>
      ipcRenderer.invoke(VCOLLECTIONS_REMOVE_MEMBERS_CHANNEL, { slug, documentIds }),
  },
  system: {
    openUri: (value: string): Promise<boolean> =>
      ipcRenderer.invoke(SYSTEM_OPEN_CHANNEL, { kind: 'uri', value }),
    openPath: (value: string): Promise<boolean> =>
      ipcRenderer.invoke(SYSTEM_OPEN_CHANNEL, { kind: 'path', value }),
    reveal: (value: string): Promise<boolean> =>
      ipcRenderer.invoke(SYSTEM_OPEN_CHANNEL, { kind: 'reveal', value }),
    requestAccess: (sourceKey: SourceKey): Promise<AccessProbeResult> =>
      ipcRenderer.invoke(SYSTEM_REQUEST_ACCESS_CHANNEL, { sourceKey }),
  },
} as const

export type AstrolabeApi = typeof api

// Fail loudly rather than leak the API onto the global object: context isolation is
// a non-negotiable secure default (docs/07, ADR-0002), so its absence is a bug, not a fallback.
if (!process.contextIsolated) {
  throw new Error('contextIsolation must be enabled')
}

contextBridge.exposeInMainWorld('astrolabe', api)
