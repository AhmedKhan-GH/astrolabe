import { eq, sql } from 'drizzle-orm'
import type { Db } from '../db'
import * as s from '../db/schema'
import { createUpsertApi, type UpsertApi } from './upsert'
import { classifyScanError } from './sync-status'
import { reconcileRemovals, documentIsOrphaned } from './removals'
import type { Connector } from '../connectors/types'
import { moduleLogger } from '../lib/logger'

const log = moduleLogger('index.sync')

export interface SyncReport {
  sourceKey: string
  ok: boolean
  available: boolean
  documentsUpserted?: number
  annotationsUpserted?: number
  /** Documents fully removed (orphaned) by the post-scan removal sweep, when one ran. */
  documentsRemoved?: number
  error?: string
}

/**
 * Scan orchestration + rebuild (ADR-0005). A failing connector degrades ONE
 * source (status → unavailable), never the app.
 */
export function createSyncApi(db: Db, registry: Connector[], upsert: UpsertApi = createUpsertApi(db)) {
  /**
   * Diff the source's live key set against the index, delete vanished instances, then settle each
   * affected document: ORPHANED (no instance left) → delete the document + its FTS row (relational
   * cascades already took its tags/collections/vc-memberships/inbound-links; search_fts is not a
   * real FK table, so its row is removed explicitly); SURVIVING → refresh its FTS row so tags and
   * annotation body stay truthful now that a source's contribution is gone. Returns the count of
   * documents fully removed.
   */
  function sweepRemovals(sourceId: number, allKeys: string[]): number {
    const affected = reconcileRemovals(db, sourceId, allKeys)
    let removed = 0
    for (const documentId of affected) {
      if (documentIsOrphaned(db, documentId)) {
        db.delete(s.documents).where(eq(s.documents.id, documentId)).run()
        db.run(sql`DELETE FROM search_fts WHERE rowid = ${documentId}`)
        removed++
      } else {
        upsert.refreshFtsRow(documentId)
      }
    }
    return removed
  }

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
      // Removal reconciliation. ONLY after a SUCCESSFUL scan that enumerated its full key set
      // (a throwing scan never reaches here, so the degrade contract stays intact; an absent
      // allExternalKeys means "can't enumerate" → no sweep). Runs BEFORE the handler-site
      // resolveLinks/syncVirtualCollections re-passes, so those see the post-sweep index.
      const documentsRemoved =
        result.allExternalKeys !== undefined ? sweepRemovals(source.id, result.allExternalKeys) : 0
      log.info(
        {
          source: connector.key,
          documents: result.documentsUpserted,
          annotations: result.annotationsUpserted,
          documentsRemoved,
        },
        'scan complete',
      )
      return {
        sourceKey: connector.key,
        ok: true,
        available: true,
        documentsUpserted: result.documentsUpserted,
        annotationsUpserted: result.annotationsUpserted,
        documentsRemoved,
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
