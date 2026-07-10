import type { AstrolabeApi } from '../../preload/index'

declare global {
  interface Window {
    /** The contextBridge allowlist (src/preload) — the renderer's only IPC surface. */
    astrolabe: AstrolabeApi
  }
}

export {}
