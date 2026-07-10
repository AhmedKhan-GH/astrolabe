import { eq } from 'drizzle-orm'
import type { Db } from '../db'
import * as s from '../db/schema'
import { createUpsertApi, type UpsertApi } from './upsert'
import { classifyScanError } from './sync-status'
import type { Connector } from '../connectors/types'
import { moduleLogger } from '../lib/logger'

const log = moduleLogger('index.sync')

export interface SyncReport {
  sourceKey: string
  ok: boolean
  available: boolean
  documentsUpserted?: number
  annotationsUpserted?: number
  error?: string
}

/**
 * Scan orchestration + rebuild (ADR-0005). A failing connector degrades ONE
 * source (status → unavailable), never the app.
 */
export function createSyncApi(db: Db, registry: Connector[], upsert: UpsertApi = createUpsertApi(db)) {
  async function syncOne(connector: Connector): Promise<SyncReport> {
    const source = upsert.ensureSource(connector.key)
    const probe = await connector.checkAvailable()
    if (!probe.available) {
      db.update(s.sources).set({ status: 'unavailable' }).where(eq(s.sources.id, source.id)).run()
      log.warn({ source: connector.key, launchHint: probe.launchHint }, 'source unavailable')
      return { sourceKey: connector.key, ok: false, available: false }
    }
    try {
      const result = await connector.scan({ db, upsert, cursor: source.syncCursor })
      db.update(s.sources)
        .set({ status: 'ok', syncCursor: result.cursor, lastSyncAt: Date.now() })
        .where(eq(s.sources.id, source.id))
        .run()
      log.info(
        { source: connector.key, documents: result.documentsUpserted, annotations: result.annotationsUpserted },
        'scan complete',
      )
      return {
        sourceKey: connector.key,
        ok: true,
        available: true,
        documentsUpserted: result.documentsUpserted,
        annotationsUpserted: result.annotationsUpserted,
      }
    } catch (err) {
      // EPERM/EACCES (macOS TCC blocking an iCloud path) reads as 'denied' —
      // fixable by granting access — not a generic 'unavailable'.
      const status = classifyScanError(err)
      db.update(s.sources).set({ status }).where(eq(s.sources.id, source.id)).run()
      log.error({ source: connector.key, status, err }, 'scan failed — source degraded')
      return { sourceKey: connector.key, ok: false, available: true, error: String(err) }
    }
  }

  async function syncAll(): Promise<SyncReport[]> {
    const reports: SyncReport[] = []
    for (const c of registry) reports.push(await syncOne(c))
    return reports
  }

  /** Derived-and-rebuildable made operational: wipe, reset cursors, full rescan. */
  async function rebuild(): Promise<SyncReport[]> {
    log.info({}, 'rebuild: wiping derived index')
    upsert.wipeDerived()
    return syncAll()
  }

  return { syncOne, syncAll, rebuild }
}

export type SyncApi = ReturnType<typeof createSyncApi>
