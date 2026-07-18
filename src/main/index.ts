import { join } from 'node:path'
import { rmSync } from 'node:fs'
import { BrowserWindow, app, ipcMain, shell } from 'electron'
import {
  DB_CHANNEL,
  FOLDERS_ADD_MEMBERS_CHANNEL,
  FOLDERS_CREATE_CHANNEL,
  FOLDERS_DELETE_CHANNEL,
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
  createFolderRequestSchema,
  deleteFolderRequestSchema,
  folderMembersRequestSchema,
  renameFolderRequestSchema,
  setFolderParentRequestSchema,
  systemOpenSchema,
} from '../shared/db-ipc'
import { moduleLogger } from './lib/logger'
import { ensureWorkspace } from './lib/workspace'
import { openDb, type DbHandle } from './db'
import { createDbDispatcher } from './db/dispatcher'
import { createUpsertApi, type UpsertApi } from './index/upsert'
import { createIndexQueries, type IndexQueries } from './index/queries'
import { syncConnector, type SyncOutcome } from './index/sync'
import { resolveLinks } from './index/links'
import { createFoldersStore, type FoldersStore } from './lib/folders'
import { refsForDocumentIds, syncFolders } from './index/folder-mirror'
import { createZoteroConnector } from './connectors/zotero'
import { createEagleConnector } from './connectors/eagle'
import { createObsidianConnector } from './connectors/obsidian'
import type { Connector } from './connectors/types'

/**
 * Composition root (skeleton). Boot: workspace → db+migrations → APIs → IPC →
 * window → background sync. Fail-fast on workspace/db (doc 10 §4); a broken
 * CONNECTOR only dims its source (sync runner degrades it, app lives on).
 */

const log = moduleLogger('main')

/** The registered connectors (M1: eagle, M2: obsidian joined the skeleton's zotero). */
const connectors: Connector[] = [
  createZoteroConnector(),
  createEagleConnector(),
  createObsidianConnector(),
]

let handle: DbHandle
let upsert: UpsertApi
let queries: IndexQueries
let foldersStore: FoldersStore

async function runSync(): Promise<SyncOutcome[]> {
  const outcomes: SyncOutcome[] = []
  for (const connector of connectors) {
    outcomes.push(await syncConnector(handle.db, upsert, connector))
  }
  // Post-sync re-pass (M2): join raw wiki-link targets to their documents —
  // full recompute, so notes scanned before their targets resolve now.
  resolveLinks(handle.db)
  // Re-mirror folders: new documents may resolve pending member refs (spec §4).
  syncFolders(handle.db, foldersStore)
  return outcomes
}

function wireIpc(): void {
  const dispatch = createDbDispatcher(handle.db)
  ipcMain.handle(DB_CHANNEL, (_e, raw: unknown) => dispatch(raw))
  ipcMain.handle(INDEX_SEARCH_CHANNEL, (_e, raw: unknown) => queries.search(raw))
  ipcMain.handle(INDEX_BROWSE_CHANNEL, (_e, raw: unknown) => queries.browse(raw))
  ipcMain.handle(INDEX_LIBRARIES_CHANNEL, () => queries.librariesSnapshot())
  ipcMain.handle(INDEX_STATS_CHANNEL, () => queries.indexStats())
  ipcMain.handle(INDEX_SYNC_CHANNEL, () => runSync())
  ipcMain.handle(INDEX_REBUILD_CHANNEL, async () => {
    upsert.wipeDerived()
    return runSync()
  })
  // Folders (spec §5): every mutate re-mirrors then returns the fresh tree, so
  // the renderer always holds one consistent snapshot. (folders:import lands in
  // the next commit — its handler is registered there, not here.)
  const mirrorAndTree = (): unknown => {
    syncFolders(handle.db, foldersStore)
    return queries.folderTree()
  }
  ipcMain.handle(FOLDERS_LIST_CHANNEL, () => queries.folderTree())
  ipcMain.handle(FOLDERS_CREATE_CHANNEL, (_e, raw: unknown) => {
    const req = createFolderRequestSchema.parse(raw)
    foldersStore.create({ name: req.name, parent: req.parent ?? null })
    return mirrorAndTree()
  })
  ipcMain.handle(FOLDERS_RENAME_CHANNEL, (_e, raw: unknown) => {
    const req = renameFolderRequestSchema.parse(raw)
    foldersStore.rename(req.slug, req.name)
    return mirrorAndTree()
  })
  ipcMain.handle(FOLDERS_SET_PARENT_CHANNEL, (_e, raw: unknown) => {
    const req = setFolderParentRequestSchema.parse(raw)
    foldersStore.setParent(req.slug, req.parent)
    return mirrorAndTree()
  })
  ipcMain.handle(FOLDERS_DELETE_CHANNEL, (_e, raw: unknown) => {
    const req = deleteFolderRequestSchema.parse(raw)
    foldersStore.remove(req.slug)
    return mirrorAndTree()
  })
  ipcMain.handle(FOLDERS_ADD_MEMBERS_CHANNEL, (_e, raw: unknown) => {
    const req = folderMembersRequestSchema.parse(raw)
    foldersStore.addMembers(req.slug, refsForDocumentIds(handle.db, req.documentIds))
    return mirrorAndTree()
  })
  ipcMain.handle(FOLDERS_REMOVE_MEMBERS_CHANNEL, (_e, raw: unknown) => {
    const req = folderMembersRequestSchema.parse(raw)
    foldersStore.removeMembers(req.slug, refsForDocumentIds(handle.db, req.documentIds))
    return mirrorAndTree()
  })
  ipcMain.handle(SYSTEM_OPEN_CHANNEL, async (_e, raw: unknown) => {
    const req = systemOpenSchema.parse(raw)
    if (req.kind === 'uri') await shell.openExternal(req.value)
    else if (req.kind === 'path') await shell.openPath(req.value)
    else shell.showItemInFolder(req.value)
    return true
  })
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    title: 'Astrolabe',
    // electron-vite emits the preload as ESM (index.mjs); Electron loads ESM
    // preloads only with the sandbox off. The bridge still runs isolated
    // (contextIsolation stays on, the default).
    webPreferences: { preload: join(__dirname, '../preload/index.mjs'), sandbox: false },
  })
  // electron-vite conventions: dev server URL in dev, bundled file in prod.
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) void win.loadURL(devUrl)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
}

/**
 * Open the index db, recreating it on schema mismatch. The index is DERIVED
 * and rebuildable (ADR-0005) — a db this code cannot migrate (e.g. the v1
 * workspace's index.db predating the v2 migration chain) is moved aside and
 * rebuilt from a scan, never a boot failure. User-owned files (manifest,
 * reading ledgers) are untouched.
 */
function openDbWithRecovery(dbPath: string): DbHandle {
  try {
    return openDb(dbPath)
  } catch (err) {
    log.warn({ err, dbPath }, 'index db unusable (schema mismatch?) — recreating; index is derived')
    for (const suffix of ['', '-wal', '-shm']) {
      rmSync(`${dbPath}${suffix}`, { force: true })
    }
    return openDb(dbPath)
  }
}

void app.whenReady().then(() => {
  const workspace = ensureWorkspace()
  handle = openDbWithRecovery(workspace.dbPath)
  upsert = createUpsertApi(handle.db)
  queries = createIndexQueries(handle.db)
  foldersStore = createFoldersStore(join(workspace.astroDir, 'folders'))

  // Decommissioned-connector self-heal: documents survive as ghosts (spec §2).
  const pruned = upsert.pruneUnknownConnectors(connectors.map((c) => c.key))
  if (pruned > 0) log.info({ pruned }, 'pruned unknown connectors (documents kept as ghosts)')

  wireIpc()
  createWindow()

  runSync()
    .then((outcomes) => log.info({ outcomes }, 'boot sync complete'))
    .catch((err: unknown) => log.warn({ err }, 'boot sync failed'))

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('quit', () => handle?.close())
