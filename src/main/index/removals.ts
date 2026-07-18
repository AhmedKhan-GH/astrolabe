import { and, eq, inArray, sql } from 'drizzle-orm'
import type { Db } from '../db'
import * as s from '../db/schema'

/**
 * Removal reconciliation v2 (spine spec v2 §2). Deletions at a source are
 * invisible to incremental scan paths — Zotero's `since`-delta and full walk
 * both exclude trashed items, Eagle drops `isDeleted` rows, an unlinked
 * Obsidian file simply stops appearing — so a vanished item can only be
 * detected by DIFFING a scan's ground-truth key set against what the index
 * holds.
 *
 * v2's cardinal rule: the diff runs within ONE LIBRARY — the library the scan
 * actually observed. v1 diffed connector-wide, so switching Eagle libraries
 * (or a group library going unreachable) read as mass deletion; here an
 * unreachable library is marked dormant and its instances are untouchable.
 * Documents are NEVER deleted on any path in this module: a document stripped
 * of its last instance is a ghost (D3), reading history intact.
 */

/** Split `arr` into groups of at most `size`, order-preserving. Keeps each `IN (...)` delete
 *  under SQLite's bound-variable ceiling when a library enumerates 10⁴+ keys. */
export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

/** Bound-variable-safe chunk width for `IN (...)` deletes (well under SQLite's default limit). */
const DELETE_CHUNK = 900

/**
 * Delete every instance of `libraryId` whose `externalKey` is NOT in `allKeys`
 * (the ground truth from a LIVE scan of that same library), and return the
 * DISTINCT documentIds those instances belonged to — some now ghosts, some
 * merely lighter; the caller (sync) decides what derived state to refresh.
 * The diff is a JS Set (O(n)); only the (usually small) stale set is deleted,
 * in bound-variable-safe chunks. Idempotent: a second call with the same
 * `allKeys` finds nothing.
 */
export function reconcileRemovals(db: Db, libraryId: number, allKeys: string[]): number[] {
  const present = new Set(allKeys)
  const existing = db
    .select({
      externalKey: s.documentInstances.externalKey,
      documentId: s.documentInstances.documentId,
    })
    .from(s.documentInstances)
    .where(eq(s.documentInstances.libraryId, libraryId))
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
            eq(s.documentInstances.libraryId, libraryId),
            inArray(s.documentInstances.externalKey, group),
          ),
        )
        .run()
    }
  })
  return [...affected]
}

/** True when no instance remains for `documentId` — the document is a ghost
 *  (spec §2): retained, hidden by default surfaces, revealed by the toggle. */
export function documentIsGhost(db: Db, documentId: number): boolean {
  const row = db
    .select({ c: sql<number>`count(*)` })
    .from(s.documentInstances)
    .where(eq(s.documentInstances.documentId, documentId))
    .get()
  return (row?.c ?? 0) === 0
}

/**
 * Presence bookkeeping (spec §2): dormant/live flips are pure flag writes —
 * marking dormant deletes NOTHING. `seenAt` stamps lastSeenAt on a live mark
 * (the moment the connector proved it could reach the corpus).
 */
export function markLibraryAvailability(
  db: Db,
  libraryId: number,
  availability: 'live' | 'dormant',
  seenAt?: number,
): void {
  db.update(s.libraries)
    .set({
      availability,
      ...(availability === 'live' && seenAt !== undefined ? { lastSeenAt: seenAt } : {}),
    })
    .where(eq(s.libraries.id, libraryId))
    .run()
}

/**
 * The explicit `gone` verdict (spec §2) — the ONLY path that removes instances
 * without a scan, and it is user-invoked, never automatic. The library row
 * survives as the record of the verdict; its documents become ghosts.
 */
export function forgetLibrary(db: Db, libraryId: number): void {
  db.transaction(() => {
    db.delete(s.documentInstances).where(eq(s.documentInstances.libraryId, libraryId)).run()
    db.delete(s.collections).where(eq(s.collections.libraryId, libraryId)).run()
    db.update(s.libraries)
      .set({ availability: 'gone', syncCursor: null })
      .where(eq(s.libraries.id, libraryId))
      .run()
  })
}
