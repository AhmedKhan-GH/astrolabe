import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Three targets from one config (docs/04, D13). Entry points use electron-vite's
// conventional locations: main → src/main/index.ts, preload → src/preload/index.ts,
// renderer root → src/renderer (with index.html). externalizeDepsPlugin keeps
// native/node deps (e.g. better-sqlite3 later) out of the main/preload bundles.
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    plugins: [react(), tailwindcss()],
  },
})
