import { and, eq, inArray, sql } from 'drizzle-orm'
import type { Db } from '../db'
import * as s from '../db/schema'

/**
 * Removal reconciliation (the sweep). Deletions at a source are invisible to the incremental
 * scan paths — Zotero's `since`-delta and full walk both exclude trashed items, Eagle drops
 * `isDeleted` rows, an unlinked Obsidian/GoodNotes file simply stops appearing — so a document
 * that vanished from a source can only be detected by DIFFING the source's currently-existing
 * key set against what the index still holds. That ground-truth key set arrives as a scan's
 * `allExternalKeys` (connectors/types.ts); this module turns it into instance deletions.
 *
 * Scope is one source: we only ever delete `document_instances` of `sourceId`. Cascades
 * (db/schema.ts) do the rest of the per-instance cleanup — `annotations.instanceId` and
 * `links.sourceInstanceId` both CASCADE, so an instance's annotations and outlinks die with it.
 * Whether the now-lighter (or orphaned) DOCUMENT is pruned or merely FTS-refreshed is the
 * caller's decision (sync.ts), driven by the returned affected documentIds.
 */

/** Split `arr` into groups of at most `size`, order-preserving. Keeps each `IN (...)` delete
 *  under SQLite's bound-variable ceiling when a source enumerates 10⁴+ keys. */
export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

/** Bound-variable-safe chunk width for `IN (...)` deletes (well under SQLite's default limit). */
const DELETE_CHUNK = 900

/**
 * Delete every `document_instances` row of `sourceId` whose `externalKey` is NOT in `allKeys`,
 * and return the DISTINCT documentIds those deleted instances belonged to (the documents whose
 * composition just changed — some may now be orphaned, some merely lighter). The diff is a JS
 * Set (O(n)), so NOT-IN never reaches SQL; only the (usually small) stale set is deleted, in
 * bound-variable-safe chunks. Idempotent: a second call with the same `allKeys` finds nothing.
 */
export function reconcileRemovals(db: Db, sourceId: number, allKeys: string[]): number[] {
  const present = new Set(allKeys)
  const existing = db
    .select({ externalKey: s.documentInstances.externalKey, documentId: s.documentInstances.documentId })
    .from(s.documentInstances)
    .where(eq(s.documentInstances.sourceId, sourceId))
    .all()

  const staleKeys: string[] = []
  const affected = new Set<number>()
  for (const row of existing) {
    if (present.has(row.externalKey)) continue
    staleKeys.push(row.externalKey)
    affected.add(row.documentId)
  }
  if (staleKeys.length === 0) return []

  db.transaction(() => {
    for (const group of chunk(staleKeys, DELETE_CHUNK)) {
      db.delete(s.documentInstances)
        .where(
          and(
            eq(s.documentInstances.sourceId, sourceId),
            inArray(s.documentInstances.externalKey, group),
          ),
        )
        .run()
    }
  })
  return [...affected]
}

/** True when no `document_instances` row remains for `documentId` (the document is orphaned). */
export function documentIsOrphaned(db: Db, documentId: number): boolean {
  const row = db
    .select({ c: sql<number>`count(*)` })
    .from(s.documentInstances)
    .where(eq(s.documentInstances.documentId, documentId))
    .get()
  return (row?.c ?? 0) === 0
}
