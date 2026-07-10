import { decompressFromBase64 } from 'lz-string'

/**
 * Pure parser for Obsidian-Excalidraw plugin notes (`*.excalidraw.md`). The plugin stores a
 * drawing as a fenced code block inside the markdown — either a ```json scene (raw) or a
 * ```compressed-json scene (LZ-String, base64). In the user's vault every note is the
 * compressed-json variant under a `# Excalidraw Data` / `## Drawing` section, but older/raw
 * notes use plain json, so we support BOTH. Keeping this pure makes it fully unit-testable and
 * keeps the (heavy) Excalidraw component out of the parse path.
 */

/** The scene pieces the read-only view needs — Excalidraw's initialData minus the collab bits. */
export interface ExcalidrawScene {
  elements: unknown[]
  appState?: Record<string, unknown>
  files?: Record<string, unknown>
}

/** Line-anchored `excalidraw-plugin` key, matched only INSIDE the leading `---` frontmatter. */
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---/
const PLUGIN_KEY = /^excalidraw-plugin\s*:/m

/**
 * A note is an Excalidraw drawing when its YAML frontmatter carries an `excalidraw-plugin`
 * key. We look ONLY inside the leading frontmatter block so a note that merely mentions
 * `excalidraw-plugin` in its prose is not mistaken for a drawing.
 */
export function isExcalidrawNote(md: string): boolean {
  const fm = FRONTMATTER.exec(md)
  return fm !== null && PLUGIN_KEY.test(fm[1]!)
}

// The Drawing payload: the FIRST ```json / ```compressed-json fenced block in the note. The
// plugin emits exactly one such block (under the Drawing heading); its language tag tells us
// whether to decompress. `[\s\S]` so the payload can span lines.
const DRAWING_BLOCK = /```(compressed-json|json)\r?\n([\s\S]*?)```/

/**
 * Extract the embedded scene from an Excalidraw note. Throws a descriptive Error on every
 * failure mode (no drawing block, corrupt base64, invalid JSON) so NoteHost can fall back to
 * the raw NoteView with a visible error line — a broken drawing must never blank the panel.
 */
export function parseExcalidrawScene(md: string): ExcalidrawScene {
  const block = DRAWING_BLOCK.exec(md)
  if (!block) throw new Error('no Excalidraw drawing block found in note')
  const [, lang, rawPayload] = block

  let json: string
  if (lang === 'compressed-json') {
    // The plugin wraps the base64 over several lines; rejoin before decompressing.
    const b64 = rawPayload!.replace(/\s+/g, '')
    const decompressed = decompressFromBase64(b64)
    if (!decompressed) throw new Error('could not decompress Excalidraw drawing data (corrupt base64)')
    json = decompressed
  } else {
    json = rawPayload!.trim()
  }

  let scene: unknown
  try {
    scene = JSON.parse(json)
  } catch (e) {
    throw new Error(`Excalidraw drawing JSON is invalid: ${e instanceof Error ? e.message : String(e)}`, {
      cause: e,
    })
  }

  // The plugin stores either {type:"excalidraw", elements, appState, files} or a bare
  // {elements, appState, files}; both carry `elements` at the top level.
  const s = scene as { elements?: unknown; appState?: unknown; files?: unknown }
  return {
    elements: Array.isArray(s.elements) ? s.elements : [],
    appState: (s.appState as Record<string, unknown> | undefined) ?? undefined,
    files: (s.files as Record<string, unknown> | undefined) ?? undefined,
  }
}
