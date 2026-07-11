import type { TransferResult } from '../../shared/db-ipc'
import { moduleLogger } from './logger'

/**
 * Eagle write path (2026-07-11-eagle-zotero-sync-spec §eagle-write; research note
 * docs/2026-07-10-zotero-write-path-research §Eagle reverse gesture). Imports a Zotero-only PDF into
 * the Eagle library via Eagle's local HTTP API (`http://localhost:41595/api/item/addFromPath`) —
 * tokenless while Eagle runs, the same surface the read connector already uses. Eagle copies the
 * file into its `.library` store (Eagle stays system of record for that copy). `website` back-links
 * the new item to its Zotero source. `fetch` is injectable so the mock-server itest asserts the
 * exact request without a real Eagle.
 *
 * NB: this lives in `src/main/lib` (not the eagle connector) because the eslint import zones forbid
 * `lib` importing `connectors` — it deliberately re-states the connector's base-url/envelope
 * conventions rather than sharing code across that boundary.
 */
const log = moduleLogger('lib.eagle-write')

const DEFAULT_BASE = 'http://localhost:41595/api'
const NOT_RUNNING = "Eagle isn't running — open it and retry"

export interface ImportDoc {
  title: string
  tags: string[]
  /** Absolute path to the PDF Eagle copies into its library. */
  filePath: string
  /** The Zotero item key — becomes the `website` back-link on the new Eagle item. */
  externalKey: string
}

/**
 * The `addFromPath` body: the file path Eagle copies, the display name, the tags, and a `website`
 * deep-link back to the Zotero item. Exported for the unit test that pins the exact shape.
 */
export function buildAddFromPathBody(doc: ImportDoc) {
  return {
    path: doc.filePath,
    name: doc.title,
    tags: doc.tags,
    website: `zotero://select/library/items/${doc.externalKey}`,
  }
}

export interface EagleWriteDeps {
  fetch?: typeof fetch
  baseUrl?: string
}

export interface EagleWrite {
  importDocument(doc: ImportDoc): Promise<TransferResult>
}

export function createEagleWrite(deps: EagleWriteDeps = {}): EagleWrite {
  const doFetch = deps.fetch ?? fetch
  const base = deps.baseUrl ?? DEFAULT_BASE

  async function importDocument(doc: ImportDoc): Promise<TransferResult> {
    try {
      const res = await doFetch(`${base}/item/addFromPath`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildAddFromPathBody(doc)),
      })
      if (!res.ok) {
        const body = await res.text().catch(() => '')
        const snippet = body.slice(0, 200).trim()
        return {
          ok: false,
          reason: `Eagle rejected the import (HTTP ${res.status})${snippet ? `: ${snippet}` : ''}`,
        }
      }
      // Eagle answers { status: 'success' | 'error', data } — a 200 with status !== success is a fail.
      const json = (await res.json().catch(() => null)) as { status?: string } | null
      if (!json || json.status !== 'success') {
        return { ok: false, reason: `Eagle rejected the import: ${JSON.stringify(json).slice(0, 200)}` }
      }
      return { ok: true }
    } catch (err) {
      log.warn({ err }, 'eagle import: api unreachable')
      return { ok: false, reason: NOT_RUNNING }
    }
  }

  return { importDocument }
}
