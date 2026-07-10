import { contextBridge, ipcRenderer } from 'electron'
import {
  DB_CHANNEL,
  INDEX_REBUILD_CHANNEL,
  INDEX_SEARCH_CHANNEL,
  INDEX_SYNC_CHANNEL,
  SYSTEM_OPEN_CHANNEL,
} from '../shared/db-ipc'
import type { Meta, NewMeta } from '../main/db/schema'
import type { SearchHit } from '../main/index/queries'
import type { SyncReport } from '../main/index/sync'

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
    search: (q: string, limit?: number): Promise<SearchHit[]> =>
      ipcRenderer.invoke(INDEX_SEARCH_CHANNEL, { q, ...(limit ? { limit } : {}) }),
    sync: (): Promise<SyncReport[]> => ipcRenderer.invoke(INDEX_SYNC_CHANNEL),
    rebuild: (): Promise<SyncReport[]> => ipcRenderer.invoke(INDEX_REBUILD_CHANNEL),
  },
  system: {
    openUri: (value: string): Promise<boolean> =>
      ipcRenderer.invoke(SYSTEM_OPEN_CHANNEL, { kind: 'uri', value }),
    openPath: (value: string): Promise<boolean> =>
      ipcRenderer.invoke(SYSTEM_OPEN_CHANNEL, { kind: 'path', value }),
    reveal: (value: string): Promise<boolean> =>
      ipcRenderer.invoke(SYSTEM_OPEN_CHANNEL, { kind: 'reveal', value }),
  },
} as const

export type AstrolabeApi = typeof api

// Fail loudly rather than leak the API onto the global object: context isolation is
// a non-negotiable secure default (docs/07, ADR-0002), so its absence is a bug, not a fallback.
if (!process.contextIsolated) {
  throw new Error('contextIsolation must be enabled')
}

contextBridge.exposeInMainWorld('astrolabe', api)
