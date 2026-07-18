import { homedir } from 'node:os'
import { join } from 'node:path'
import { sha256File } from '../../lib/hash'
import { moduleLogger } from '../../lib/logger'
import type {
  Connector,
  ConnectorScan,
  ConnectorScanContext,
  LibraryScanResult,
} from '../types'
import { createZoteroClient, type ZoteroClient, type ZoteroLibraryApi } from './client'
import { mapCollections, mapItemsToDocuments, type ZoteroScope } from './mapping'

/**
 * Zotero read connector v2 (spine spec v2 §1–2): enumerates the personal
 * library PLUS every group the local client carries (D2) and scans each as its
 * own library. Deterministic, zero-token, poll-based.
 *
 * Per-library incremental (v1 semantics, now per corpus): each library keeps
 * its own `Last-Modified-Version` cursor. On an incremental scan we cheaply
 * probe how many items changed; if none, unchanged:true (upserts skipped). If
 * any changed we do a FULL walk and remap of THAT library — annotation →
 * attachment → item chaining needs its complete item graph. The keys set for
 * the removal sweep is fetched on EVERY scan (deletions are invisible to the
 * `since` delta), per library.
 */

const log = moduleLogger('connector.zotero')

export const PERSONAL_STABLE_KEY = 'personal'
export const PERSONAL_DISPLAY_NAME = 'My Library'
export const groupStableKey = (groupId: number): string => `group:${groupId}`

/** Default Zotero data dir; stored files (personal AND group) live at
 *  <dataDir>/storage/<KEY>/<filename>. */
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

  /** One library's scan (shared personal/group path). */
  async function scanLibrary(
    api: ZoteroLibraryApi,
    scope: ZoteroScope,
    stableKey: string,
    displayName: string,
    previousCursor: string | null,
  ): Promise<LibraryScanResult> {
    // The live key set — fetched on EVERY scan (even the early-out): a trash
    // operation never shows up in the `since` delta, so the sweep is the only
    // path that observes a Zotero deletion.
    const allExternalKeys = await api.fetchAllTopLevelKeys()

    const previousVersion = previousCursor != null ? Number(previousCursor) : null
    if (previousVersion != null && Number.isFinite(previousVersion)) {
      const { changed, libraryVersion } = await api.countChangedSince(previousVersion)
      if (changed === 0) {
        log.info({ stableKey, cursor: previousCursor }, 'zotero library unchanged; sweep only')
        return {
          stableKey,
          displayName,
          cursor: libraryVersion != null ? String(libraryVersion) : previousCursor,
          unchanged: true,
          documents: [],
          collections: [],
          allExternalKeys,
        }
      }
      log.info({ stableKey, changed }, 'zotero library changed since cursor; full remap')
    }

    const collections = mapCollections(await api.fetchCollections())
    const { items, libraryVersion } = await api.fetchAllItems(null)
    const { documents, skipped } = mapItemsToDocuments(items, { dataDir, scope })
    if (skipped > 0) log.warn({ stableKey, skipped }, 'skipped malformed zotero items')

    // Hash the resolved PDF only when it exists on disk (sha256File → null if
    // missing/oversized); a null hash simply forgoes the cross-library join.
    const hashed = []
    for (const doc of documents) {
      const contentSha256 = doc.filePath ? await sha256File(doc.filePath) : null
      hashed.push({ ...doc, contentSha256 })
    }

    log.info(
      { stableKey, documents: hashed.length, libraryVersion },
      'zotero library scan complete',
    )
    return {
      stableKey,
      displayName,
      cursor: libraryVersion != null ? String(libraryVersion) : null,
      unchanged: false,
      documents: hashed,
      collections,
      allExternalKeys,
    }
  }

  async function scan(ctx: ConnectorScanContext): Promise<ConnectorScan> {
    const groups = await client.fetchGroups()
    const targets: { api: ZoteroLibraryApi; scope: ZoteroScope; stableKey: string; displayName: string }[] = [
      {
        api: client.library('/users/0'),
        scope: { kind: 'personal' },
        stableKey: PERSONAL_STABLE_KEY,
        displayName: PERSONAL_DISPLAY_NAME,
      },
      ...groups.map((g) => ({
        api: client.library(`/groups/${g.id}`),
        scope: { kind: 'group', groupId: g.id } as ZoteroScope,
        stableKey: groupStableKey(g.id),
        displayName: g.name,
      })),
    ]

    const libraries: LibraryScanResult[] = []
    for (const t of targets) {
      libraries.push(
        await scanLibrary(t.api, t.scope, t.stableKey, t.displayName, ctx.cursors.get(t.stableKey) ?? null),
      )
    }
    return { libraries }
  }

  async function checkAvailable(): Promise<{ available: boolean; launchHint?: string }> {
    const available = await client.checkAvailable()
    return available ? { available } : { available: false, launchHint: 'open -a Zotero' }
  }

  async function accessProbePath(): Promise<string | null> {
    return join(dataDir, 'storage')
  }

  return { key: 'zotero', checkAvailable, scan, accessProbePath }
}
