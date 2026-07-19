import { and, eq, ne } from 'drizzle-orm'
import type { Db } from '../db'
import * as s from '../db/schema'
import { moduleLogger } from '../lib/logger'
import type { Connector, LibraryDocumentInput } from '../connectors/types'
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

/** A single instance healed in place from oldKey → newKey within one library
 *  (identity hardening 1 §2). `library` is `${connectorKey}:${stableKey}` — the
 *  same shape a folder path-ref carries, so the folders store can rewrite refs. */
export interface InstanceRenamedEvent {
  library: string
  oldKey: string
  newKey: string
}

export interface SyncOptions {
  /** Fired once per healed rename, before the upsert loop lands the new key. */
  onInstanceRenamed?: (ev: InstanceRenamedEvent) => void
}

/** Read a persisted renameHint out of an instance's metaJson; null when absent
 *  or unparseable (a note indexed before hints existed, or a hand-edit). */
function metaHint(metaJson: string | null): string | null {
  if (!metaJson) return null
  try {
    const parsed = JSON.parse(metaJson) as { renameHint?: unknown }
    return typeof parsed.renameHint === 'string' ? parsed.renameHint : null
  } catch {
    return null
  }
}

/**
 * The rename-healing pass (identity hardening 1 §2), generic over connectors.
 * Runs BEFORE the library's upsert loop, only on a changed scan that carries
 * full ground truth (allExternalKeys) — never heal on partial knowledge.
 *
 *  - removed = indexed instances of this library whose externalKey is gone from
 *    the scan AND that carry a renameHint in metaJson;
 *  - added   = scan documents with no instance at (library, key) that carry a
 *    renameHint;
 *  - pair on hint equality ONLY when a hint maps to exactly one removed and
 *    exactly one added (duplicate-content ambiguity heals nothing — the normal
 *    sweep then applies). Renamed-AND-edited differs in hint → never pairs.
 *
 * A heal UPDATES the existing instance row in place (externalKey/uri/filePath/
 * metaJson → incoming); the document row is untouched, so everything
 * document-anchored survives. The upsert loop then finds the instance at the new
 * key and proceeds as a normal update; the sweep sees nothing stale.
 */
function healRenames(
  db: Db,
  library: string,
  libraryId: number,
  libScan: { documents: LibraryDocumentInput[]; allExternalKeys?: string[] },
  onInstanceRenamed?: (ev: InstanceRenamedEvent) => void,
): void {
  if (!libScan.allExternalKeys) return
  const present = new Set(libScan.allExternalKeys)

  const indexed = db
    .select()
    .from(s.documentInstances)
    .where(eq(s.documentInstances.libraryId, libraryId))
    .all()
  const indexedKeys = new Set(indexed.map((i) => i.externalKey))

  const removedByHint = new Map<string, s.DocumentInstance[]>()
  for (const inst of indexed) {
    if (present.has(inst.externalKey)) continue // still there — not removed
    const hint = metaHint(inst.metaJson)
    if (hint === null) continue
    ;(removedByHint.get(hint) ?? removedByHint.set(hint, []).get(hint)!).push(inst)
  }

  const addedByHint = new Map<string, LibraryDocumentInput[]>()
  for (const doc of libScan.documents) {
    if (indexedKeys.has(doc.externalKey)) continue // an update, not a new key
    if (doc.renameHint == null) continue
    ;(addedByHint.get(doc.renameHint) ?? addedByHint.set(doc.renameHint, []).get(doc.renameHint)!).push(doc)
  }

  // Hints still carried by a SURVIVING instance: a new note with such a hint may
  // be a COPY of the survivor rather than a rename of the removed one, so the
  // hint no longer uniquely identifies a source/target — ambiguous, heal nothing
  // (spec §4: duplicate-content notes are the safe-default no-heal case).
  const survivorHints = new Set<string>()
  for (const inst of indexed) {
    if (!present.has(inst.externalKey)) continue
    const hint = metaHint(inst.metaJson)
    if (hint !== null) survivorHints.add(hint)
  }

  for (const [hint, removed] of removedByHint) {
    const added = addedByHint.get(hint)
    // Exactly-one-pair rule: a hint heals only when it maps to exactly one
    // removed, exactly one added, and no surviving duplicate — anything else is
    // ambiguous (duplicate-content notes) and heals nothing.
    if (!added || removed.length !== 1 || added.length !== 1 || survivorHints.has(hint)) continue
    const inst = removed[0]!
    const doc = added[0]!
    db.update(s.documentInstances)
      .set({
        externalKey: doc.externalKey,
        uri: doc.uri,
        filePath: doc.filePath ?? null,
        metaJson: doc.metaJson ?? null,
      })
      .where(eq(s.documentInstances.id, inst.id))
      .run()
    log.info({ library, oldKey: inst.externalKey, newKey: doc.externalKey }, 'healed note rename')
    onInstanceRenamed?.({ library, oldKey: inst.externalKey, newKey: doc.externalKey })
  }
}

export async function syncConnector(
  db: Db,
  upsert: UpsertApi,
  connector: Connector,
  now: number = Date.now(),
  opts?: SyncOptions,
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
      // Rename healing (spec §2) BEFORE the upsert loop: re-point a surviving
      // instance from its old key to the new one so the upsert lands as an
      // update and the sweep sees nothing stale. Only on full ground truth.
      healRenames(
        db,
        `${connector.key}:${libScan.stableKey}`,
        row.id,
        libScan,
        opts?.onInstanceRenamed,
      )
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
