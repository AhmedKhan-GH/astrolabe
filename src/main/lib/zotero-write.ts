import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import type { TransferResult } from '../../shared/db-ipc'
import { moduleLogger } from './logger'

/**
 * Zotero write path (2026-07-11-eagle-zotero-sync-spec §zotero-write; research note
 * docs/2026-07-10-zotero-write-path-research). Promotes an Eagle-only PDF into the local Zotero via
 * the CONNECTOR server (`http://localhost:23119/connector/*`) — the same surface the browser
 * Connector uses: local, keyless, and Zotero stores its own file copy (it stays system of record).
 *
 * Two calls, one session: `saveItems` creates a parent item, then `saveAttachment` streams the raw
 * PDF bytes tied to that item by `X-Metadata`. Gotcha (research §Gotchas): do NOT send
 * `X-Zotero-Connector-API-Version` — it trips a version-warning gate. `fetch` + `readFile` are
 * injectable so the mock-server itest asserts exact request framing without a real Zotero.
 */
const log = moduleLogger('lib.zotero-write')

const DEFAULT_BASE = 'http://localhost:23119'
const NOT_RUNNING = "Zotero isn't running — open it and retry"

export interface PromoteDoc {
  title: string
  tags: string[]
  /** Absolute path to the PDF whose bytes become the attachment. */
  filePath: string
}

/**
 * The `saveItems` body: one translator-item shaped like a Zotero connector item. v1 pins
 * `itemType: 'document'` (no metadata guessing — Zotero's own retrieve-metadata does that better
 * post-promote) and maps the document's tags to Zotero's `[{tag}]` shape. Exported for the unit
 * test that pins the exact shape.
 */
export function buildSaveItemsBody(sessionID: string, doc: PromoteDoc) {
  return {
    sessionID,
    items: [
      {
        id: 'itm1',
        itemType: 'document',
        title: doc.title,
        tags: doc.tags.map((tag) => ({ tag })),
      },
    ],
  }
}

/** The `X-Metadata` header for `saveAttachment`: ties the streamed PDF to the parent item. */
export function buildAttachmentMetadata(sessionID: string, doc: PromoteDoc) {
  return { sessionID, parentItemID: 'itm1', title: doc.title }
}

export interface ZoteroWriteDeps {
  fetch?: typeof fetch
  readFile?: (path: string) => Promise<Buffer>
  baseUrl?: string
}

export interface ZoteroWrite {
  promoteDocument(doc: PromoteDoc): Promise<TransferResult>
}

export function createZoteroWrite(deps: ZoteroWriteDeps = {}): ZoteroWrite {
  const doFetch = deps.fetch ?? fetch
  const read = deps.readFile ?? ((p: string) => readFile(p))
  const base = deps.baseUrl ?? DEFAULT_BASE

  async function promoteDocument(doc: PromoteDoc): Promise<TransferResult> {
    // Read the bytes first so a missing/unreadable file never masquerades as "Zotero isn't running"
    // and never leaves an orphan parent item behind.
    let bytes: Buffer
    try {
      bytes = await read(doc.filePath)
    } catch (err) {
      log.warn({ err, filePath: doc.filePath }, 'zotero promote: file unreadable')
      return { ok: false, reason: `Could not read the file to promote: ${String(err)}` }
    }

    const sessionID = randomUUID()
    try {
      const itemsRes = await doFetch(`${base}/connector/saveItems`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildSaveItemsBody(sessionID, doc)),
      })
      if (!itemsRes.ok) return await httpFailure('saveItems', itemsRes)

      const attachRes = await doFetch(`${base}/connector/saveAttachment`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/pdf',
          'X-Metadata': JSON.stringify(buildAttachmentMetadata(sessionID, doc)),
        },
        body: bytes,
      })
      if (!attachRes.ok) return await httpFailure('saveAttachment', attachRes)
      return { ok: true }
    } catch (err) {
      // A thrown fetch = connection refused / network failure = Zotero not listening.
      log.warn({ err }, 'zotero promote: connector unreachable')
      return { ok: false, reason: NOT_RUNNING }
    }
  }

  return { promoteDocument }
}

/** Map a non-2xx connector response to a user-renderable reason carrying the status + body snippet. */
async function httpFailure(op: string, res: Response): Promise<TransferResult> {
  const body = await res.text().catch(() => '')
  const snippet = body.slice(0, 200).trim()
  return {
    ok: false,
    reason: `Zotero rejected the ${op} (HTTP ${res.status})${snippet ? `: ${snippet}` : ''}`,
  }
}
