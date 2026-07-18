import { basename } from 'node:path'
import { sha256File } from '../../lib/hash'
import { moduleLogger } from '../../lib/logger'
import type {
  Connector,
  ConnectorScan,
  ConnectorScanContext,
  LibraryScanResult,
} from '../types'
import { createEagleClient, type EagleClient } from './client'
import { flattenFolders, mapItems } from './mapping'

/**
 * Eagle read connector v2 (spine spec v2 §1–2). Eagle exposes exactly ONE open
 * library at a time, so `scan()` returns a SINGLE LibraryScanResult keyed by the
 * library PATH (`/library/info`). Switching Eagle's open library is a library
 * switch: the previous path is simply absent from the next scan, so sync marks it
 * dormant and deletes NOTHING (spec §2) — v1's connector-wide diff would have read
 * that as mass deletion. This is where the Zotero↔Eagle hash join lights up: every
 * resolvable item file is SHA-256'd, so a copy already held by Zotero merges into one
 * document (upsert §2). Iron rules: imports no other connector; a down/throwing Eagle
 * degrades to one dim source, never the app.
 *
 * Incremental strategy (v1 watermark, now per library): no server-side mtime filter
 * exists, so we walk all item metadata each scan (cheap — metadata only), take the max
 * `modificationTime` as the cursor, and upsert only items strictly newer than the
 * previous cursor. `allExternalKeys` (every non-deleted id) is emitted on EVERY scan —
 * a trash is invisible to the watermark, so the library-scoped sweep is the only path
 * that observes an Eagle deletion.
 */
const log = moduleLogger('connector.eagle')

const PAGE_SIZE = 200
/** Hard stop against a pathological pager; 200 * 2000 pages = 400k items is plenty. */
const MAX_PAGES = 2000
const LAUNCH_HINT = 'open -a Eagle'

export interface EagleConnectorOptions {
  client?: EagleClient
}

export function createEagleConnector(options: EagleConnectorOptions = {}): Connector {
  const client = options.client ?? createEagleClient()

  /** Every non-trashed item's raw row across all pages (metadata only, cheap). */
  async function fetchAllItems(): Promise<unknown[]> {
    const all: unknown[] = []
    for (let page = 0; page < MAX_PAGES; page++) {
      const rows = await client.itemList({ limit: PAGE_SIZE, page })
      all.push(...rows)
      if (rows.length < PAGE_SIZE) break
    }
    return all
  }

  async function scanLibrary(ctx: ConnectorScanContext): Promise<LibraryScanResult> {
    const library = await client.libraryInfo()
    const stableKey = library.path
    const displayName = library.name?.trim() || basename(library.path)
    const previousCursor = ctx.cursors.get(stableKey) ?? null

    const collections = flattenFolders(library.folders)
    const docs = mapItems(await fetchAllItems(), library.path) // non-deleted, mapped

    // The complete live key set — the removal-sweep ground truth (spec §2).
    // mapItems drops isDeleted rows, so a trashed item is correctly absent here →
    // the sweep removes its stale instance, within THIS library only.
    const allExternalKeys = docs.map((d) => d.externalKey)

    // Watermark cursor: max modificationTime over ALL non-deleted items (a skipped
    // item still advances the mark, exactly as v1). Upsert only items strictly
    // newer than the previous cursor.
    const cursorNum =
      previousCursor != null && Number.isFinite(Number(previousCursor)) ? Number(previousCursor) : null
    let maxMod = cursorNum ?? 0
    for (const doc of docs) if (doc.modifiedAt > maxMod) maxMod = doc.modifiedAt
    const cursor = docs.length > 0 ? String(maxMod) : previousCursor
    const changed = cursorNum != null ? docs.filter((d) => d.modifiedAt > cursorNum) : docs

    // Nothing newer than the cursor → unchanged: sync skips documents/collections
    // but STILL runs the sweep from allExternalKeys (a deletion is invisible to the
    // watermark).
    if (cursorNum != null && changed.length === 0) {
      log.info({ library: stableKey, cursor }, 'eagle library unchanged; sweep only')
      return {
        stableKey,
        displayName,
        cursor,
        unchanged: true,
        documents: [],
        collections: [],
        allExternalKeys,
      }
    }

    // The hash join: resolvable file → content hash → merges with a Zotero-held copy.
    // A missing/unreadable/oversized file degrades to no-join (null), never a crash.
    const hashed = []
    for (const doc of changed) {
      const contentSha256 = doc.filePath ? await sha256File(doc.filePath) : null
      hashed.push({ ...doc, contentSha256 })
    }

    log.info(
      { library: stableKey, scanned: docs.length, upserted: hashed.length, cursor },
      'eagle library scan complete',
    )
    return {
      stableKey,
      displayName,
      cursor,
      unchanged: false,
      documents: hashed,
      collections,
      allExternalKeys,
    }
  }

  async function scan(ctx: ConnectorScanContext): Promise<ConnectorScan> {
    return { libraries: [await scanLibrary(ctx)] }
  }

  async function checkAvailable(): Promise<{ available: boolean; launchHint?: string }> {
    try {
      await client.applicationInfo(1000)
      return { available: true }
    } catch {
      return { available: false, launchHint: LAUNCH_HINT }
    }
  }

  /** The library dir is the protected surface (file hashing reads it directly);
   *  contract: never throws — Eagle not running degrades to null. */
  async function accessProbePath(): Promise<string | null> {
    try {
      return (await client.libraryInfo()).path
    } catch {
      return null
    }
  }

  return { key: 'eagle', checkAvailable, scan, accessProbePath }
}
