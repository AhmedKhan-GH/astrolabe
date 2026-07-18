import { and, eq, ne } from 'drizzle-orm'
import type { Db } from '../db'
import * as s from '../db/schema'
import { moduleLogger } from '../lib/logger'
import type { Connector } from '../connectors/types'
import type { UpsertApi } from './upsert'
import { markLibraryAvailability, reconcileRemovals } from './removals'

/**
 * The sync runner v2 (spine spec v2 §2): owns every index write a scan causes.
 * A connector RETURNS per-library payloads; this module lands them —
 * ensureLibrary, collections, documents, the LIBRARY-SCOPED removal sweep,
 * FTS refresh for swept documents, cursor + lastScanAt persistence — and
 * enforces the presence rules:
 *  - connector unreachable → connector 'unavailable', every non-gone library
 *    marked DORMANT, nothing deleted;
 *  - a known library the scan did not mention (left a group, switched Eagle
 *    library) → DORMANT, nothing deleted;
 *  - instances die only via the sweep, inside their own scanned library.
 */

const log = moduleLogger('index.sync')

export interface LibrarySyncOutcome {
  stableKey: string
  displayName: string
  documentsUpserted: number
  removed: number
  unchanged: boolean
}

export interface SyncOutcome {
  connector: string
  status: 'ok' | 'unavailable'
  libraries: LibrarySyncOutcome[]
}

export async function syncConnector(
  db: Db,
  upsert: UpsertApi,
  connector: Connector,
  now: number = Date.now(),
): Promise<SyncOutcome> {
  const conn = upsert.ensureConnector(connector.key)

  const markAllDormant = (): void => {
    const rows = db
      .select()
      .from(s.libraries)
      .where(and(eq(s.libraries.connectorId, conn.id), ne(s.libraries.availability, 'gone')))
      .all()
    for (const row of rows) markLibraryAvailability(db, row.id, 'dormant')
  }

  const degrade = (reason: unknown): SyncOutcome => {
    log.warn({ connector: connector.key, reason }, 'connector degraded; libraries dormant, nothing deleted')
    db.update(s.connectors).set({ status: 'unavailable' }).where(eq(s.connectors.id, conn.id)).run()
    markAllDormant()
    return { connector: connector.key, status: 'unavailable', libraries: [] }
  }

  const avail = await connector.checkAvailable()
  if (!avail.available) return degrade(avail.launchHint ?? 'unavailable')

  // Previous cursors per stableKey; 'gone' libraries are the user's verdict —
  // never rescanned, never resurrected here.
  const known = db.select().from(s.libraries).where(eq(s.libraries.connectorId, conn.id)).all()
  const cursors = new Map<string, string | null>(
    known.filter((l) => l.availability !== 'gone').map((l) => [l.stableKey, l.syncCursor]),
  )

  let scan
  try {
    scan = await connector.scan({ cursors })
  } catch (err) {
    return degrade(err)
  }

  db.update(s.connectors).set({ status: 'ok' }).where(eq(s.connectors.id, conn.id)).run()

  const outcomes: LibrarySyncOutcome[] = []
  const seen = new Set<string>()
  for (const libScan of scan.libraries) {
    const gone = known.find((l) => l.stableKey === libScan.stableKey && l.availability === 'gone')
    if (gone) continue // the verdict stands even if the connector still sees it
    seen.add(libScan.stableKey)
    const row = upsert.ensureLibrary(connector.key, libScan.stableKey, libScan.displayName)
    markLibraryAvailability(db, row.id, 'live', now)

    let documentsUpserted = 0
    if (!libScan.unchanged) {
      upsert.upsertCollections(row.id, libScan.collections)
      for (const doc of libScan.documents) {
        upsert.upsertDocument({ ...doc, libraryId: row.id })
        documentsUpserted++
      }
    }

    let removed = 0
    if (libScan.allExternalKeys) {
      const affected = reconcileRemovals(db, row.id, libScan.allExternalKeys)
      for (const documentId of affected) upsert.refreshFtsRow(documentId)
      removed = affected.length
    }

    db.update(s.libraries)
      .set({ syncCursor: libScan.cursor, lastScanAt: now })
      .where(eq(s.libraries.id, row.id))
      .run()

    outcomes.push({
      stableKey: libScan.stableKey,
      displayName: libScan.displayName,
      documentsUpserted,
      removed,
      unchanged: libScan.unchanged,
    })
  }

  // Known libraries the scan did not mention: unreachable now (left group,
  // switched Eagle library, unmounted vault) → dormant. NOTHING is deleted.
  for (const l of known) {
    if (!seen.has(l.stableKey) && l.availability !== 'gone') {
      log.info({ connector: connector.key, stableKey: l.stableKey }, 'library not in scan; dormant')
      markLibraryAvailability(db, l.id, 'dormant')
    }
  }

  return { connector: connector.key, status: 'ok', libraries: outcomes }
}
