import { fileURLToPath } from 'node:url'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { viteStaticCopy } from 'vite-plugin-static-copy'

// pdf.js runtime asset packs → out/renderer/pdfjs/<dir>. The src must be an
// ABSOLUTE glob: the renderer's Vite root is src/renderer, and any relative or
// directory-shaped src makes static-copy mirror the escape path (node_modules/…)
// into dest instead of flattening; an absolute glob pins the base to <dir> itself.
const pdfjsAsset = (dir: string): { src: string; dest: string; rename: { stripBase: true } } => ({
  src: fileURLToPath(new URL(`node_modules/pdfjs-dist/${dir}/*`, import.meta.url)),
  dest: `pdfjs/${dir}`,
  // stripBase drops the glob's base directories from the destination — without it the
  // plugin mirrors the whole node_modules/pdfjs-dist/<dir> escape path under dest.
  rename: { stripBase: true },
})

// Excalidraw ships its fonts under dist/prod/fonts/<Family>/*.woff2 — nested a level deeper
// than pdf.js's flat packs, and the library requests them by that exact `fonts/<Family>/<file>`
// path, so the <Family>/ segment MUST survive the copy. stripBase:true would flatten it away;
// we instead strip exactly the six leading segments of the matched dir
// (node_modules/@excalidraw/excalidraw/dist/prod/fonts) and KEEP the 7th (<Family>), landing
// files at out/renderer/excalidraw/fonts/<Family>/…, which ExcalidrawView points
// EXCALIDRAW_ASSET_PATH at. Without local fonts the library fetches them from a CDN (unpkg) at
// runtime — unacceptable in a desktop app.
const excalidrawFonts = (): { src: string; dest: string; rename: { stripBase: number } } => ({
  src: fileURLToPath(new URL('node_modules/@excalidraw/excalidraw/dist/prod/fonts/**/*', import.meta.url)),
  dest: 'excalidraw/fonts',
  rename: { stripBase: 6 },
})

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
    // Excalidraw checks `process.env.IS_PREACT` at module scope; Vite leaves it undefined
    // unless defined, which crashes the bundle. It's a React (not Preact) app, so 'false'.
    define: { 'process.env.IS_PREACT': JSON.stringify('false') },
    plugins: [
      react(),
      tailwindcss(),
      // pdf.js v6 runtime asset packs, served beside the bundle (the dev server AND the
      // packaged astro://app host, which serves out/renderer verbatim). Without these,
      // pdf.js silently drops content: wasm = JBIG2/JPEG2000 image decoders (scanned
      // books), cmaps = CID/CJK text encodings, standard_fonts = non-embedded base
      // fonts, iccs = color profiles. usePdfDocument points getDocument at pdfjs/.
      viteStaticCopy({
        targets: [
          pdfjsAsset('cmaps'),
          pdfjsAsset('standard_fonts'),
          pdfjsAsset('wasm'),
          pdfjsAsset('iccs'),
          excalidrawFonts(),
        ],
      }),
    ],
  },
})
