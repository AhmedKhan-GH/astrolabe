import { join } from 'node:path'
import { rmSync } from 'node:fs'
import { BrowserWindow, app, ipcMain, shell } from 'electron'
import {
  DB_CHANNEL,
  FOLDERS_ADD_MEMBERS_CHANNEL,
  FOLDERS_CREATE_CHANNEL,
  FOLDERS_DELETE_CHANNEL,
  FOLDERS_IMPORT_CHANNEL,
  FOLDERS_LIST_CHANNEL,
  FOLDERS_REMOVE_MEMBERS_CHANNEL,
  FOLDERS_RENAME_CHANNEL,
  FOLDERS_SET_PARENT_CHANNEL,
  INDEX_BROWSE_CHANNEL,
  INDEX_DOCUMENT_CHANNEL,
  INDEX_LIBRARIES_CHANNEL,
  INDEX_REBUILD_CHANNEL,
  INDEX_SEARCH_CHANNEL,
  INDEX_STATS_CHANNEL,
  INDEX_SYNC_CHANNEL,
  INDEX_TAGS_CHANNEL,
  EAGLE_LIBRARIES_CHANNEL,
  EAGLE_SWITCH_CHANNEL,
  EAGLE_SYNC_ALL_CHANNEL,
  SYSTEM_OPEN_CHANNEL,
  createFolderRequestSchema,
  deleteFolderRequestSchema,
  eagleSwitchRequestSchema,
  folderMembersRequestSchema,
  importFoldersRequestSchema,
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
import { createEagleSwitcher } from './index/eagle-switch'
import { resolveLinks } from './index/links'
import { createFoldersStore, type FoldersStore } from './lib/folders'
import { refsForDocumentIds, syncFolders } from './index/folder-mirror'
import { importLibraryTree } from './index/folder-import'
import { createZoteroConnector } from './connectors/zotero'
import { createEagleConnector } from './connectors/eagle'
import { createEagleClient } from './connectors/eagle/client'
import { createObsidianConnector } from './connectors/obsidian'
import type { Connector } from './connectors/types'

/**
 * Composition root (skeleton). Boot: workspace → db+migrations → APIs → IPC →
 * window → background sync. Fail-fast on workspace/db (doc 10 §4); a broken
 * CONNECTOR only dims its source (sync runner degrades it, app lives on).
 */

const log = moduleLogger('main')

// One Eagle client instance shared by the connector (scans) and the switcher
// (library commands) — same localhost API, same stateless client (spec §B).
const eagleClient = createEagleClient()
const eagleConnector = createEagleConnector({ client: eagleClient })

/** The registered connectors (M1: eagle, M2: obsidian joined the skeleton's zotero). */
const connectors: Connector[] = [
  createZoteroConnector(),
  eagleConnector,
  createObsidianConnector(),
]

let handle: DbHandle
let upsert: UpsertApi
let queries: IndexQueries
let foldersStore: FoldersStore

async function runSync(): Promise<SyncOutcome[]> {
  const outcomes: SyncOutcome[] = []
  for (const connector of connectors) {
    // Rename healing (identity hardening 1 §3): a healed instance rewrites its
    // folder path-refs in place; the post-sync syncFolders re-mirror below then
    // picks the change up. No new channels.
    outcomes.push(
      await syncConnector(handle.db, upsert, connector, Date.now(), {
        onInstanceRenamed: (ev) => foldersStore.renamePathRefs(ev.library, ev.oldKey, ev.newKey),
      }),
    )
  }
  // Post-sync re-pass (M2): join raw wiki-link targets to their documents —
  // full recompute, so notes scanned before their targets resolve now.
  resolveLinks(handle.db)
  // Re-mirror folders: new documents may resolve pending member refs (spec §4).
  syncFolders(handle.db, foldersStore)
  return outcomes
}

/** Land a single Eagle scan through the SAME wiring runSync uses (spec §B): the
 *  switcher routes its post-switch sync here so there is one code path for an
 *  Eagle scan (rename-healing opts + the folder/link re-passes). */
async function runEagleSync(): Promise<SyncOutcome> {
  const outcome = await syncConnector(handle.db, upsert, eagleConnector, Date.now(), {
    onInstanceRenamed: (ev) => foldersStore.renamePathRefs(ev.library, ev.oldKey, ev.newKey),
  })
  resolveLinks(handle.db)
  syncFolders(handle.db, foldersStore)
  return outcome
}

function wireIpc(): void {
  const eagleSwitcher = createEagleSwitcher({ client: eagleClient, runEagleSync })
  const dispatch = createDbDispatcher(handle.db)
  ipcMain.handle(DB_CHANNEL, (_e, raw: unknown) => dispatch(raw))
  ipcMain.handle(INDEX_SEARCH_CHANNEL, (_e, raw: unknown) => queries.search(raw))
  ipcMain.handle(INDEX_BROWSE_CHANNEL, (_e, raw: unknown) => queries.browse(raw))
  ipcMain.handle(INDEX_LIBRARIES_CHANNEL, () => queries.librariesSnapshot())
  ipcMain.handle(INDEX_STATS_CHANNEL, () => queries.indexStats())
  ipcMain.handle(INDEX_DOCUMENT_CHANNEL, (_e, raw: unknown) => queries.documentDetail(raw))
  ipcMain.handle(INDEX_TAGS_CHANNEL, () => queries.tagsList())
  ipcMain.handle(INDEX_SYNC_CHANNEL, () => runSync())
  ipcMain.handle(INDEX_REBUILD_CHANNEL, async () => {
    upsert.wipeDerived()
    return runSync()
  })
  // Eagle library switching (spec §B): explicit, user-driven gestures only —
  // switching visibly changes Eagle's own window, so never automatic.
  ipcMain.handle(EAGLE_LIBRARIES_CHANNEL, () => eagleSwitcher.listLibraries())
  ipcMain.handle(EAGLE_SWITCH_CHANNEL, (_e, raw: unknown) => {
    const req = eagleSwitchRequestSchema.parse(raw)
    return eagleSwitcher.switchAndSync(req.libraryPath)
  })
  ipcMain.handle(EAGLE_SYNC_ALL_CHANNEL, () => eagleSwitcher.syncAllLibraries())
  // Folders (spec §5): every mutate re-mirrors then returns the fresh tree, so
  // the renderer always holds one consistent snapshot.
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
    const { record, previousSlug } = foldersStore.rename(req.slug, req.name)
    // Names aren't unique (spec §5: "the response carries the new slug") —
    // the renderer can't re-locate the folder from the tree alone.
    syncFolders(handle.db, foldersStore)
    return { tree: queries.folderTree(), slug: record.slug, previousSlug }
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
  // Seed import (spec §6b): lift a source tree into a fresh root, re-mirror, and
  // return the user-renderable counts (not the tree — the renderer re-lists).
  ipcMain.handle(FOLDERS_IMPORT_CHANNEL, (_e, raw: unknown) => {
    const req = importFoldersRequestSchema.parse(raw)
    const result = importLibraryTree(handle.db, foldersStore, req)
    syncFolders(handle.db, foldersStore)
    return result
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
