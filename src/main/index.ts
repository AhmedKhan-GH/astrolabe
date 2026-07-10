import { app, BrowserWindow, shell } from 'electron'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { moduleLogger } from './lib/logger'

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

// Boot order: app-ready → window. (The DB → IPC steps join this chain in Phase 0/1,
// ahead of window creation, per docs/07.)
app.whenReady().then(() => {
  log.info(
    { electron: process.versions.electron, packaged: app.isPackaged },
    'app ready — creating window',
  )
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
