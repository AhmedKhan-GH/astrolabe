import { contextBridge, ipcRenderer } from 'electron'
import {
  FOLDERS_ADD_MEMBERS_CHANNEL,
  FOLDERS_CREATE_CHANNEL,
  FOLDERS_DELETE_CHANNEL,
  FOLDERS_IMPORT_CHANNEL,
  FOLDERS_LIST_CHANNEL,
  FOLDERS_REMOVE_MEMBERS_CHANNEL,
  FOLDERS_RENAME_CHANNEL,
  FOLDERS_SET_PARENT_CHANNEL,
  INDEX_BROWSE_CHANNEL,
  INDEX_LIBRARIES_CHANNEL,
  INDEX_REBUILD_CHANNEL,
  INDEX_SEARCH_CHANNEL,
  INDEX_STATS_CHANNEL,
  INDEX_SYNC_CHANNEL,
  SYSTEM_OPEN_CHANNEL,
  type CreateFolderRequest,
  type DeleteFolderRequest,
  type FolderMembersRequest,
  type ImportFoldersRequest,
  type ImportFoldersResult,
  type LibrariesSnapshot,
  type RenameFolderRequest,
  type SetFolderParentRequest,
  type SystemOpenRequest,
} from '../shared/db-ipc'
import type {
  BrowsePage,
  BrowseRequest,
  FolderTreeNode,
  IndexStats,
  SearchHit,
  SearchRequest,
} from '../main/index/queries'
import type { SyncOutcome } from '../main/index/sync'

/**
 * The typed bridge (skeleton surface). Type-only imports from main keep the
 * wire honest without dragging main-process code into the preload bundle.
 * Requests are validated main-side (zod at the handler); the renderer just
 * gets the typed surface.
 */
const api = {
  search: (req: Partial<SearchRequest> & { q: string }): Promise<SearchHit[]> =>
    ipcRenderer.invoke(INDEX_SEARCH_CHANNEL, req),
  browse: (req: Partial<BrowseRequest>): Promise<BrowsePage> =>
    ipcRenderer.invoke(INDEX_BROWSE_CHANNEL, req),
  libraries: (): Promise<LibrariesSnapshot> => ipcRenderer.invoke(INDEX_LIBRARIES_CHANNEL),
  stats: (): Promise<IndexStats> => ipcRenderer.invoke(INDEX_STATS_CHANNEL),
  sync: (): Promise<SyncOutcome[]> => ipcRenderer.invoke(INDEX_SYNC_CHANNEL),
  rebuild: (): Promise<SyncOutcome[]> => ipcRenderer.invoke(INDEX_REBUILD_CHANNEL),
  open: (req: SystemOpenRequest): Promise<boolean> => ipcRenderer.invoke(SYSTEM_OPEN_CHANNEL, req),
  folders: {
    list: (): Promise<FolderTreeNode[]> => ipcRenderer.invoke(FOLDERS_LIST_CHANNEL),
    create: (req: CreateFolderRequest): Promise<FolderTreeNode[]> =>
      ipcRenderer.invoke(FOLDERS_CREATE_CHANNEL, req),
    rename: (req: RenameFolderRequest): Promise<FolderTreeNode[]> =>
      ipcRenderer.invoke(FOLDERS_RENAME_CHANNEL, req),
    setParent: (req: SetFolderParentRequest): Promise<FolderTreeNode[]> =>
      ipcRenderer.invoke(FOLDERS_SET_PARENT_CHANNEL, req),
    remove: (req: DeleteFolderRequest): Promise<FolderTreeNode[]> =>
      ipcRenderer.invoke(FOLDERS_DELETE_CHANNEL, req),
    addMembers: (req: FolderMembersRequest): Promise<FolderTreeNode[]> =>
      ipcRenderer.invoke(FOLDERS_ADD_MEMBERS_CHANNEL, req),
    removeMembers: (req: FolderMembersRequest): Promise<FolderTreeNode[]> =>
      ipcRenderer.invoke(FOLDERS_REMOVE_MEMBERS_CHANNEL, req),
    import: (req: ImportFoldersRequest): Promise<ImportFoldersResult> =>
      ipcRenderer.invoke(FOLDERS_IMPORT_CHANNEL, req),
  },
}

export type AstrolabeApi = typeof api

contextBridge.exposeInMainWorld('astrolabe', api)
