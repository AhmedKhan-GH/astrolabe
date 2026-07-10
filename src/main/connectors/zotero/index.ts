import { homedir } from 'node:os'
import { join } from 'node:path'
import { sha256File } from '../../lib/hash'
import { moduleLogger } from '../../lib/logger'
import type { Connector, ResolveResult, ScanResult, SyncContext } from '../types'
import { createZoteroClient, type ZoteroClient } from './client'
import { mapCollections, mapItemsToDocuments } from './mapping'

/**
 * Zotero read connector (runway step 4). Deterministic, zero-token. Poll-based
 * (Zotero has no push): sync runs on boot / "Sync now" / interval (scheduled by
 * sync.ts, not here). A broken or absent Zotero dims this source only — scan()
 * throwing is the contract's degrade signal.
 *
 * Incremental: the local API supports `?since=<libraryVersion>` (verified — see
 * client.ts). On an incremental scan we cheaply probe how many items changed; if
 * none, we no-op. If any changed we do a FULL walk and full remap, because
 * annotation→attachment→item chaining needs the complete item graph (a changed
 * annotation whose parent attachment is unchanged would not appear in a `since`
 * delta, so a delta-only remap could not resolve its document). The library is
 * small and paginated at 100/page, so a full walk on change is cheap and correct.
 * There is no `/deleted` endpoint locally, so removals reconcile only via Rebuild.
 */

const log = moduleLogger('connector.zotero')

/** Default Zotero data dir on this machine; stored files live at <dataDir>/storage/<KEY>/<filename>. */
function defaultDataDir(): string {
  return join(homedir(), 'Zotero')
}

export interface ZoteroConnectorOptions {
  client?: ZoteroClient
  dataDir?: string
}

export function createZoteroConnector(options: ZoteroConnectorOptions = {}): Connector {
  const client = options.client ?? createZoteroClient()
  const dataDir = options.dataDir ?? defaultDataDir()

  async function scan(ctx: SyncContext): Promise<ScanResult> {
    const previousVersion = ctx.cursor != null ? Number(ctx.cursor) : null

    if (previousVersion != null && Number.isFinite(previousVersion)) {
      const { changed, libraryVersion } = await client.countChangedSince(previousVersion)
      if (changed === 0) {
        log.info({ cursor: ctx.cursor }, 'zotero unchanged since cursor; skipping scan')
        return {
          cursor: libraryVersion != null ? String(libraryVersion) : ctx.cursor,
          documentsUpserted: 0,
          annotationsUpserted: 0,
        }
      }
      log.info({ changed, cursor: ctx.cursor }, 'zotero changed since cursor; full remap')
    }

    // Collections first so document collectionKeys resolve on upsert.
    const collections = mapCollections(await client.fetchCollections())
    ctx.upsert.upsertCollections('zotero', collections)

    const { items, libraryVersion } = await client.fetchAllItems(null)
    const { documents, skipped } = mapItemsToDocuments(items, { dataDir })
    if (skipped > 0) log.warn({ skipped }, 'skipped malformed zotero items')

    let documentsUpserted = 0
    let annotationsUpserted = 0
    for (const doc of documents) {
      // Hash the resolved PDF only when it exists on disk (sha256File → null if
      // missing/oversized); a null hash simply forgoes the cross-source join.
      const contentSha256 = doc.filePath ? await sha256File(doc.filePath) : null
      ctx.upsert.upsertDocument({ ...doc, contentSha256 })
      documentsUpserted++
      annotationsUpserted += doc.annotations?.length ?? 0
    }

    log.info({ documentsUpserted, annotationsUpserted, libraryVersion }, 'zotero scan complete')
    return {
      cursor: libraryVersion != null ? String(libraryVersion) : null,
      documentsUpserted,
      annotationsUpserted,
    }
  }

  async function checkAvailable(): Promise<{ available: boolean; launchHint?: string }> {
    const available = await client.checkAvailable()
    return available ? { available } : { available: false, launchHint: 'open -a Zotero' }
  }

  async function resolve(uri: string): Promise<ResolveResult> {
    // Zotero deep links are opened by the OS via the zotero:// handler.
    return { uri }
  }

  return { key: 'zotero', checkAvailable, scan, resolve }
}

export const zoteroConnector = createZoteroConnector()
