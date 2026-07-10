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
}
