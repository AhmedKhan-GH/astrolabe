import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import {
  ACP_AGENTS_CHANNEL,
  ACP_CANCEL_CHANNEL,
  ACP_DIALOGUES_LIST_CHANNEL,
  ACP_DIALOGUES_READ_CHANNEL,
  ACP_PERMISSION_REQUEST_EVENT,
  ACP_PERMISSION_RESPONSE_CHANNEL,
  ACP_PROMPT_CHANNEL,
  ACP_SESSION_NEW_CHANNEL,
  ACP_SET_CONFIG_CHANNEL,
  ACP_SET_MODE_CHANNEL,
  ACP_UPDATE_EVENT,
  DB_CHANNEL,
  INDEX_BROWSE_CHANNEL,
  INDEX_DOCUMENT_CHANNEL,
  INDEX_LINKS_CHANNEL,
  INDEX_NAV_CHANNEL,
  INDEX_PAGE_ANNOTATIONS_CHANNEL,
  INDEX_REBUILD_CHANNEL,
  INDEX_SOURCES_CHANNEL,
  INDEX_STATS_CHANNEL,
  INDEX_SEARCH_CHANNEL,
  INDEX_SYNC_CHANNEL,
  RECONCILE_TRANSFER_CHANNEL,
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
  DocumentDetail,
  IndexStats,
  NavData,
  PageAnnotations,
  SearchHit,
  SearchRequest,
  SourceSummary,
} from '../main/index/queries'
import type { SyncReport } from '../main/index/sync'
import type { DocumentLinks } from '../main/index/links'
import type { AccessProbeResult } from '../main/system/access'
import type { SourceKey } from '../main/connectors/types'
import type { SavedView, SaveViewRequest } from '../main/lib/views'
import type { VCollectionSummary } from '../main/lib/vcollections'
import type {
  AcpAgentDescriptor,
  AcpAgentKey,
  AcpDialogueSummary,
  AcpPermissionRequestEvent,
  AcpSessionResult,
  AcpStoredDialogue,
  AcpUpdateEvent,
  TransferDirection,
  TransferResult,
} from '../shared/db-ipc'

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
    pageAnnotations: (documentId: number): Promise<PageAnnotations> =>
      ipcRenderer.invoke(INDEX_PAGE_ANNOTATIONS_CHANNEL, { documentId }),
    links: (documentId: number): Promise<DocumentLinks> =>
      ipcRenderer.invoke(INDEX_LINKS_CHANNEL, { documentId }),
    document: (documentId: number): Promise<DocumentDetail | null> =>
      ipcRenderer.invoke(INDEX_DOCUMENT_CHANNEL, { documentId }),
    sync: (): Promise<SyncReport[]> => ipcRenderer.invoke(INDEX_SYNC_CHANNEL),
    rebuild: (): Promise<SyncReport[]> => ipcRenderer.invoke(INDEX_REBUILD_CHANNEL),
    sources: (): Promise<SourceSummary[]> => ipcRenderer.invoke(INDEX_SOURCES_CHANNEL),
    stats: (): Promise<IndexStats> => ipcRenderer.invoke(INDEX_STATS_CHANNEL),
    // Eagle↔Zotero sync gesture: move one document's bytes into the other system of record. Lives
    // on the existing `index` surface (NO new top-level key — the e2e allowlist stays stable).
    transfer: (documentId: number, direction: TransferDirection): Promise<TransferResult> =>
      ipcRenderer.invoke(RECONCILE_TRANSFER_CHANNEL, { documentId, direction }),
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
  acp: {
    // The ACP client surface (2026-07-11-acp-dialogue-spec §Wire). Requests are invoke-style;
    // session output + permission prompts arrive via the on* subscriptions, each returning an
    // unsubscribe fn so the renderer can tear listeners down without leaking.
    agents: (): Promise<AcpAgentDescriptor[]> => ipcRenderer.invoke(ACP_AGENTS_CHANNEL),
    newSession: (agentKey: AcpAgentKey): Promise<AcpSessionResult> =>
      ipcRenderer.invoke(ACP_SESSION_NEW_CHANNEL, { agentKey }),
    // Ack only — the turn's output streams back via onUpdate (spec §Wire); the renderer ignores
    // the resolved value, so the surface is typed as a bare ack.
    prompt: (sessionId: string, text: string): Promise<void> =>
      ipcRenderer.invoke(ACP_PROMPT_CHANNEL, { sessionId, text }),
    cancel: (sessionId: string): Promise<void> => ipcRenderer.invoke(ACP_CANCEL_CHANNEL, { sessionId }),
    respondPermission: (requestId: string, optionId: string): Promise<void> =>
      ipcRenderer.invoke(ACP_PERMISSION_RESPONSE_CHANNEL, { requestId, optionId }),
    setMode: (sessionId: string, modeId: string): Promise<void> =>
      ipcRenderer.invoke(ACP_SET_MODE_CHANNEL, { sessionId, modeId }),
    setConfig: (sessionId: string, configId: string, value: string | boolean): Promise<void> =>
      ipcRenderer.invoke(ACP_SET_CONFIG_CHANNEL, { sessionId, configId, value }),
    // History browser (v1.1): list past dialogues + read one back by its store filename.
    dialogues: (): Promise<AcpDialogueSummary[]> => ipcRenderer.invoke(ACP_DIALOGUES_LIST_CHANNEL),
    readDialogue: (file: string): Promise<AcpStoredDialogue> =>
      ipcRenderer.invoke(ACP_DIALOGUES_READ_CHANNEL, { file }),
    onUpdate: (cb: (event: AcpUpdateEvent) => void): (() => void) => {
      const listener = (_e: IpcRendererEvent, event: AcpUpdateEvent): void => cb(event)
      ipcRenderer.on(ACP_UPDATE_EVENT, listener)
      return () => ipcRenderer.removeListener(ACP_UPDATE_EVENT, listener)
    },
    onPermissionRequest: (cb: (event: AcpPermissionRequestEvent) => void): (() => void) => {
      const listener = (_e: IpcRendererEvent, event: AcpPermissionRequestEvent): void => cb(event)
      ipcRenderer.on(ACP_PERMISSION_REQUEST_EVENT, listener)
      return () => ipcRenderer.removeListener(ACP_PERMISSION_REQUEST_EVENT, listener)
    },
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
