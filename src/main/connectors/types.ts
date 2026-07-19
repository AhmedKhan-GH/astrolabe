import type { CollectionInput, DocumentInput } from '../index/upsert'

/**
 * The connector contract v2 (spine spec v2 §1–2). Connectors are deterministic,
 * zero-token modules. Iron rules (doc 10 §5): connectors never import each
 * other; each is independently disableable; a broken connector dims one source,
 * never the app.
 *
 * v2 vs v1: a connector no longer writes to the index — it RETURNS one scan
 * payload PER LIBRARY it can currently see (zotero: personal + each group;
 * eagle: the open library; obsidian: each configured vault), and the sync
 * runner (index/sync.ts) owns all writes, cursor persistence, the
 * library-scoped removal sweep, and dormant-marking of libraries the scan did
 * not mention. Deep-link opening rides system:open; no resolve() indirection.
 */
export type ConnectorKey = 'zotero' | 'eagle' | 'obsidian'

/** A document as the connector reports it — the library is implicit in which
 *  LibraryScanResult carries it; sync supplies the row id. */
export type LibraryDocumentInput = Omit<DocumentInput, 'libraryId'> & {
  /**
   * Opaque content-derived fingerprint for sync-time RENAME HEALING (identity
   * hardening 1 §1). A connector that emits it MUST also persist it inside this
   * instance's `metaJson` under the key `renameHint`: sync reads OLD hints from
   * `instances.metaJson` and INCOMING hints from here. Hash-identified sources
   * (zotero/eagle) leave it undefined — their keys are stable, no healing needed.
   */
  renameHint?: string
}

/** One library's scan payload — everything sync needs to land it in the index. */
export interface LibraryScanResult {
  /** Stable identity under this connector: 'personal' / 'group:<id>' /
   *  library path / vault path (libraries.stable_key). */
  stableKey: string
  displayName: string
  /** Cursor to persist for the next incremental scan of THIS library. */
  cursor: string | null
  /** true = nothing changed since the previous cursor: documents/collections
   *  are empty and skipped; the sweep still runs when allExternalKeys is
   *  present (a deletion is invisible to version deltas). */
  unchanged: boolean
  documents: LibraryDocumentInput[]
  collections: CollectionInput[]
  /**
   * The COMPLETE set of externalKeys currently existing in this library — the
   * ground truth for the library-scoped removal sweep (index/removals.ts).
   * ABSENT = the connector can't cheaply enumerate this library's full key
   * set, so sync performs NO sweep for it (never delete on partial knowledge).
   * Present-but-empty = a legitimately empty library (sweep everything).
   */
  allExternalKeys?: string[]
}

export interface ConnectorScanContext {
  /** Previous cursor per library stableKey (libraries.sync_cursor); a library
   *  absent from the map has never been scanned (or was rebuilt). */
  cursors: ReadonlyMap<string, string | null>
}

export interface ConnectorScan {
  libraries: LibraryScanResult[]
}

export interface Connector {
  readonly key: ConnectorKey
  /** Cheap availability probe (port check / dir exists). Never throws. */
  checkAvailable(): Promise<{ available: boolean; launchHint?: string }>
  /** Enumerate + read every reachable library. Throws = connector degraded
   *  (sync marks the connector unavailable and its libraries dormant). */
  scan(ctx: ConnectorScanContext): Promise<ConnectorScan>
  /** Optional file watching (Obsidian, M2). Returns unwatch. */
  watch?(onChange: () => void): () => void
  /** The on-disk root this connector reads, for the permission probe. Null
   *  when unconfigured or no protected surface. Never throws. */
  accessProbePath?(): Promise<string | null>
}
