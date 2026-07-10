import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { moduleLogger } from './lib/logger'
import { ensureWorkspace } from './lib/workspace'
import { openDb } from './db'
import { createDbDispatcher } from './db/dispatcher'
import { createUpsertApi } from './index/upsert'
import { createIndexQueries } from './index/queries'
import { createSyncApi } from './index/sync'
import { createViewsApi } from './lib/views'
import { createVCollectionsApi, syncVirtualCollections } from './lib/vcollections'
import { connectors } from './connectors/registry'
import {
  DB_CHANNEL,
  INDEX_BROWSE_CHANNEL,
  INDEX_NAV_CHANNEL,
  INDEX_PAGE_ANNOTATIONS_CHANNEL,
  INDEX_REBUILD_CHANNEL,
  INDEX_SEARCH_CHANNEL,
  INDEX_SOURCES_CHANNEL,
  INDEX_STATS_CHANNEL,
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
  requestAccessSchema,
  systemOpenSchema,
} from '../shared/db-ipc'
import { createAccessApi, FULL_DISK_ACCESS_SETTINGS_URI } from './system/access'
import { APP_INDEX_URL, registerAstroProtocol, registerAstroProtocolPrivileges } from './system/doc-protocol'

// ESM main process — derive the directory the built file lives in (out/main/).
const currentDir = dirname(fileURLToPath(import.meta.url))
const log = moduleLogger('main')

// astro:// (Canvas view, docs/2026-07-10-canvas-view-spec §Serving PDF bytes): scheme
// privileges MUST be declared before app.whenReady — module load is the only safe point.
registerAstroProtocolPrivileges()

/**
 * Create the single application window with the secure defaults recorded in
 * docs/07 and ADR-0002: context isolation on, node integration off, a
 * contextBridge-only surface (the preload), and outbound navigation denied.
 * The window is shown only once the renderer is ready, to avoid a white flash.
 */
function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    webPreferences: {
      preload: join(currentDir, '../preload/index.mjs'),
      // The named secure defaults (docs/07, ADR-0002): the renderer is isolated
      // from Node and the preload, reachable only through the contextBridge allowlist.
      contextIsolation: true,
      nodeIntegration: false,
      // sandbox is left off so the preload can be an ES module (a sandboxed preload
      // must be CommonJS). contextIsolation — not sandbox — is the load-bearing
      // control here; full OS sandboxing is a future hardening step (would need a
      // CJS-emitted preload) and a candidate for its own ADR when we take it.
      sandbox: false,
    },
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  // Navigation containment: open external links in the OS browser, never a new
  // Electron window (Electron security checklist).
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  // electron-vite serves the renderer over HTTP in dev (HMR) and from disk when packaged.
  const rendererUrl = process.env['ELECTRON_RENDERER_URL']
  if (rendererUrl) {
    void mainWindow.loadURL(rendererUrl)
  } else {
    // Served over astro://app, NOT loadFile: a file:// document may never fetch a
    // custom scheme (Blink hard allowlist), which would break every astro://doc load.
    void mainWindow.loadURL(APP_INDEX_URL)
  }
}

// Boot order: workspace → DB → IPC → window, fail-fast quit on any init error
// (docs/07 secure defaults; doc 10 §4 fail closed — a half-configured app must
// not limp into a window).
app.whenReady().then(() => {
  try {
    const ws = ensureWorkspace()
    const handle = openDb(ws.dbPath)
    const dispatch = createDbDispatcher(handle.db)
    const upsert = createUpsertApi(handle.db)
    const queries = createIndexQueries(handle.db)
    const syncApi = createSyncApi(handle.db, connectors, upsert)
    // Saved views are a user artifact, not index data — one JSON file per view under the
    // workspace, so they survive a rebuild and ride file-sync (docs/2026-07-10-lens-saved-views).
    const viewsApi = createViewsApi(join(ws.astroDir, 'views'))
    // Virtual collections: user-owned M:N grouping, one JSON file per collection under the
    // workspace, mirrored into SQLite for facet filtering (docs/2026-07-10-lens-virtual-collections).
    const collectionsDir = join(ws.astroDir, 'collections')
    const vcollectionsApi = createVCollectionsApi(collectionsDir, handle.db)
    // Bring the mirror current from the files at boot (it is derived — the files are truth).
    syncVirtualCollections(handle.db, collectionsDir)
    ipcMain.handle(DB_CHANNEL, (_event, req: unknown) => dispatch(req))
    ipcMain.handle(INDEX_SEARCH_CHANNEL, (_event, req: unknown) => queries.search(req))
    // A sync/rebuild changes which documents (and content hashes) exist, so re-resolve the
    // virtual-collection mirror against the fresh index afterward (at the handler site, per spec —
    // sync.ts stays unaware of collections).
    ipcMain.handle(INDEX_SYNC_CHANNEL, async () => {
      const report = await syncApi.syncAll()
      syncVirtualCollections(handle.db, collectionsDir)
      return report
    })
    ipcMain.handle(INDEX_REBUILD_CHANNEL, async () => {
      const report = await syncApi.rebuild()
      syncVirtualCollections(handle.db, collectionsDir)
      return report
    })
    ipcMain.handle(INDEX_SOURCES_CHANNEL, () => queries.sourceSummaries())
    ipcMain.handle(INDEX_STATS_CHANNEL, () => queries.indexStats())
    // Library Navigator read paths (docs/2026-07-10): the recency river + nav rail.
    ipcMain.handle(INDEX_BROWSE_CHANNEL, (_event, req: unknown) => queries.browse(req))
    ipcMain.handle(INDEX_NAV_CHANNEL, () => queries.nav())
    // Canvas view (docs/2026-07-10-canvas-view-spec): per-page annotation heat + the
    // astro:// server (doc host allowlisted by the index — the renderer names instance
    // ids, never paths; app host serves the packaged renderer bundle).
    ipcMain.handle(INDEX_PAGE_ANNOTATIONS_CHANNEL, (_event, req: unknown) => queries.pageAnnotations(req))
    registerAstroProtocol(() => handle.db, join(currentDir, '../renderer'))
    // Saved-view CRUD (validation is at the module boundary via zod, like the query handlers).
    ipcMain.handle(VIEWS_LIST_CHANNEL, () => viewsApi.list())
    ipcMain.handle(VIEWS_SAVE_CHANNEL, (_event, raw: unknown) => viewsApi.save(raw))
    ipcMain.handle(VIEWS_DELETE_CHANNEL, (_event, raw: unknown) => viewsApi.remove(raw))
    // Virtual-collection CRUD + membership (validation at the module boundary via zod). Each
    // mutation rewrites its file atomically then re-mirrors, so reads stay consistent.
    ipcMain.handle(VCOLLECTIONS_LIST_CHANNEL, () => vcollectionsApi.list())
    ipcMain.handle(VCOLLECTIONS_CREATE_CHANNEL, (_event, raw: unknown) => vcollectionsApi.create(raw))
    ipcMain.handle(VCOLLECTIONS_DELETE_CHANNEL, (_event, raw: unknown) => vcollectionsApi.remove(raw))
    ipcMain.handle(VCOLLECTIONS_ADD_MEMBERS_CHANNEL, (_event, raw: unknown) => vcollectionsApi.addMembers(raw))
    ipcMain.handle(VCOLLECTIONS_REMOVE_MEMBERS_CHANNEL, (_event, raw: unknown) =>
      vcollectionsApi.removeMembers(raw),
    )
    // Grant-access probe: an fs read from THIS process summons the native macOS
    // consent dialog; a hard TCC denial falls back to the Full Disk Access pane
    // (which no app can prompt for programmatically — deep-link only).
    const accessApi = createAccessApi(connectors, {
      openSettings: () => shell.openExternal(FULL_DISK_ACCESS_SETTINGS_URI),
    })
    ipcMain.handle(SYSTEM_REQUEST_ACCESS_CHANNEL, (_event, raw: unknown) => {
      const req = requestAccessSchema.parse(raw)
      return accessApi.requestAccess(req.sourceKey)
    })
    ipcMain.handle(SYSTEM_OPEN_CHANNEL, async (_event, raw: unknown) => {
      const req = systemOpenSchema.parse(raw) // scheme allowlist enforced in the schema
      if (req.kind === 'uri') await shell.openExternal(req.value)
      else if (req.kind === 'path') await shell.openPath(req.value)
      else shell.showItemInFolder(req.value)
      return true
    })
    log.info(
      { workspace: ws.root, workspaceId: ws.manifest.workspaceId, packaged: app.isPackaged },
      'workspace + db + ipc ready — creating window',
    )
  } catch (err) {
    log.fatal({ err }, 'boot failed at workspace/db init')
    dialog.showErrorBox('Astrolabe failed to start', String(err))
    app.quit()
    return
  }
  createWindow()

  // macOS: re-create a window when the dock icon is clicked and none are open.
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

// Quit when all windows are closed, except on macOS where apps stay resident.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
