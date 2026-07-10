import { sha256File } from '../../lib/hash'
import { moduleLogger } from '../../lib/logger'
import type { Connector, ScanResult, SyncContext } from '../types'
import { createEagleClient, type EagleClient } from './client'
import { flattenFolders, mapItems } from './mapping'

/**
 * The Eagle connector (runway step 5): read-sync of items + folders, and the point
 * where the Zotero↔Eagle hash join lights up — every resolvable item file is SHA-256'd
 * so a copy already held by Zotero merges into one document (upsert.ts §2). Iron rules:
 * imports no other connector, degrades to one dim source if Eagle is down or throws.
 *
 * VERIFIED semantics recorded in client.ts / mapping.ts. Incremental strategy: no
 * server-side mtime filter exists, so we walk all item metadata each scan (cheap —
 * metadata only), skip items whose modificationTime ≤ the cursor, and hash only the
 * survivors. The watermark cursor is the max modificationTime seen.
 */
const log = moduleLogger('connector.eagle')

const PAGE_SIZE = 200
/** Hard stop against a pathological pager; 200 * 2000 pages = 400k items is plenty. */
const MAX_PAGES = 2000
const LAUNCH_HINT = 'open -a Eagle'

export function createEagleConnector(client: EagleClient = createEagleClient()): Connector {
  async function fetchAllItems(): Promise<unknown[]> {
    const all: unknown[] = []
    for (let page = 0; page < MAX_PAGES; page++) {
      const rows = await client.itemList({ limit: PAGE_SIZE, page })
      all.push(...rows)
      if (rows.length < PAGE_SIZE) break
    }
    return all
  }

  return {
    key: 'eagle',

    async checkAvailable() {
      try {
        await client.applicationInfo(1000)
        return { available: true }
      } catch {
        return { available: false, launchHint: LAUNCH_HINT }
      }
    },

    async scan(ctx: SyncContext): Promise<ScanResult> {
      const library = await client.libraryInfo()
      ctx.upsert.upsertCollections('eagle', flattenFolders(library.folders))

      const rawItems = await fetchAllItems()
      const docs = mapItems(rawItems, library.path)

      const cursorNum =
        ctx.cursor != null && Number.isFinite(Number(ctx.cursor)) ? Number(ctx.cursor) : null
      let maxMod = cursorNum ?? 0
      let documentsUpserted = 0

      for (const doc of docs) {
        if (doc.modifiedAt > maxMod) maxMod = doc.modifiedAt
        if (cursorNum != null && doc.modifiedAt <= cursorNum) continue

        // The hash join: resolvable file → content hash → merges with a Zotero-held copy.
        // A missing/unreadable file degrades to no-join (null), never a crash.
        const contentSha256 = doc.filePath ? await sha256File(doc.filePath) : null
        ctx.upsert.upsertDocument(contentSha256 ? { ...doc, contentSha256 } : doc)
        documentsUpserted++
      }

      const cursor = docs.length > 0 ? String(maxMod) : ctx.cursor
      log.info(
        { library: library.path, scanned: docs.length, documentsUpserted, cursor },
        'eagle scan complete',
      )
      return { cursor, documentsUpserted, annotationsUpserted: 0 }
    },

    async resolve(uri: string) {
      return { uri }
    },
  }
}

/** Default instance the registry wires in (runway step 5). */
export const eagleConnector = createEagleConnector()
