import { contextBridge } from 'electron'

/**
 * The single, explicit IPC surface exposed to the renderer — an allowlist, never a
 * blanket `ipcRenderer` passthrough. The typed table-client and connector channels
 * (the salvaged pattern, docs/01 salvage manifest) are added here deliberately in
 * Phase 0/1; for now it carries only runtime version info to prove the bridge end to end.
 */
const api = {
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
} as const

export type AstrolabeApi = typeof api

// Fail loudly rather than leak the API onto the global object: context isolation is
// a non-negotiable secure default (docs/07, ADR-0002), so its absence is a bug, not a fallback.
if (!process.contextIsolated) {
  throw new Error('contextIsolation must be enabled')
}

contextBridge.exposeInMainWorld('astrolabe', api)
