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
        ],
      }),
    ],
  },
})
