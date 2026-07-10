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
import { connectors } from './connectors/registry'
import {
  DB_CHANNEL,
  INDEX_REBUILD_CHANNEL,
  INDEX_SEARCH_CHANNEL,
  INDEX_SYNC_CHANNEL,
  SYSTEM_OPEN_CHANNEL,
  systemOpenSchema,
} from '../shared/db-ipc'

// ESM main process — derive the directory the built file lives in (out/main/).
const currentDir = dirname(fileURLToPath(import.meta.url))
const log = moduleLogger('main')

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
    void mainWindow.loadFile(join(currentDir, '../renderer/index.html'))
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
    ipcMain.handle(DB_CHANNEL, (_event, req: unknown) => dispatch(req))
    ipcMain.handle(INDEX_SEARCH_CHANNEL, (_event, req: unknown) => queries.search(req))
    ipcMain.handle(INDEX_SYNC_CHANNEL, () => syncApi.syncAll())
    ipcMain.handle(INDEX_REBUILD_CHANNEL, () => syncApi.rebuild())
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
