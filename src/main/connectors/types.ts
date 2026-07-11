import type { Db } from '../db'
import type { UpsertApi } from '../index/upsert'

/**
 * The connector contract (docs/03 Layer 2; runway step 3). Connectors are
 * deterministic, zero-token modules. Iron rules (doc 10 §5, enforced by
 * eslint-plugin-import-x zones): connectors never import each other; each is
 * independently disableable; a broken connector dims one source, never the app.
 */
export type SourceKey = 'zotero' | 'eagle' | 'obsidian'

export interface SyncContext {
  db: Db
  upsert: UpsertApi
  /** Incremental cursor from the previous scan (sources.sync_cursor); null on first/rebuild. */
  cursor: string | null
}

export interface ScanResult {
  /** Cursor to persist for the next incremental scan. */
  cursor: string | null
  documentsUpserted: number
  annotationsUpserted: number
  /**
   * The COMPLETE set of externalKeys currently existing at the source, independent of any
   * watermark/version skip — the ground truth for removal reconciliation (index/removals.ts).
   * ABSENT (`undefined`) = the connector can't cheaply enumerate its full key set, so sync
   * performs NO sweep for this run (the safe default — never delete on partial knowledge). A
   * successful scan returning an empty array is a legitimately empty source (sweep everything).
   */
  allExternalKeys?: string[]
}

export interface ResolveResult {
  /** Something the OS can open: a deep-link URI and/or an absolute file path. */
  uri?: string
  filePath?: string
}

export interface Connector {
  readonly key: SourceKey
  /** Cheap availability probe (port check / dir exists). Never throws. */
  checkAvailable(): Promise<{ available: boolean; launchHint?: string }>
  /** Incremental scan: read the source, upsert into the index. Throws = source degraded. */
  scan(ctx: SyncContext): Promise<ScanResult>
  /** Provenance URI → openable target. */
  resolve(uri: string): Promise<ResolveResult>
  /** Optional file watching (Obsidian). Returns unwatch. */
  watch?(onChange: () => void): () => void
  /**
   * The on-disk root this connector reads (vault / Eagle library), for the
   * in-app permission probe (system/access.ts). Null when unconfigured or the
   * source has no protected disk surface. Never throws.
   */
  accessProbePath?(): Promise<string | null>
}
