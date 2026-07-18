import { z } from 'zod'

/**
 * Wire contract v2 (spine spec v2, docs/2026-07-17). The single source of truth
 * for every IPC channel name and layer-free request schema crossing the
 * main↔preload↔renderer boundary.
 *
 * Conventions carried from v1 (docs/01 audit ceiling):
 *  - FTS, joins, and transactions never ride the generic table-client; they get
 *    named channels (`index:search`, `index:browse`, …).
 *  - Request schemas that derive from module-owned types (e.g. the browse
 *    filter set from queries.ts) live WITH their module, not here — this file
 *    stays layer-free so preload can import it without dragging drizzle in.
 *
 * Channels enter this file in the commit whose feature needs them — the v1
 * grab-bag (ACP, views, reading, transfer, vcollections) returns milestone by
 * milestone.
 */

// ── Generic typed table-client (salvage-manifest pattern) ────────────────────
export const DB_CHANNEL = 'db:query'

const row = z.record(z.string(), z.unknown())
const id = z.number().int().positive()

export const dbRequestSchema = z.discriminatedUnion('op', [
  z.object({ table: z.string(), op: z.literal('getAll') }),
  z.object({ table: z.string(), op: z.literal('getById'), id }),
  z.object({ table: z.string(), op: z.literal('create'), values: row }),
  z.object({ table: z.string(), op: z.literal('update'), id, values: row }),
  z.object({ table: z.string(), op: z.literal('delete'), id }),
])
export type DbRequest = z.infer<typeof dbRequestSchema>

// ── Index read/maintenance paths (named channels) ────────────────────────────
export const INDEX_SEARCH_CHANNEL = 'index:search'
export const INDEX_BROWSE_CHANNEL = 'index:browse'
export const INDEX_SYNC_CHANNEL = 'index:sync'
export const INDEX_REBUILD_CHANNEL = 'index:rebuild'
export const INDEX_STATS_CHANNEL = 'index:stats'

// ── Libraries (spine v2 §1–2) — replaces v1's `index:sources` ────────────────
// One connector exposes N libraries (zotero: personal + each group; eagle: the
// open library path; obsidian: each configured vault). Availability is
// per-library; nothing under a dormant library is ever deleted (spec §2).
export const INDEX_LIBRARIES_CHANNEL = 'index:libraries'

export const connectorKeySchema = z.enum(['zotero', 'eagle', 'obsidian'])
export type ConnectorKey = z.infer<typeof connectorKeySchema>

/** 'denied' = blocked by OS permissions (macOS TCC) — distinct from
 *  'unavailable' (tool not running / unconfigured) so the UI can offer a fix. */
export type ConnectorStatus = 'ok' | 'unavailable' | 'denied' | 'disabled'

/** live = reachable now · dormant = known but unreachable (never deleted) ·
 *  gone = user said "forget this library" (instances dropped, ghosts remain). */
export type LibraryAvailability = 'live' | 'dormant' | 'gone'

/** One row of the libraries surface: a connector's library and its standing. */
export interface LibraryInfo {
  id: number
  connector: ConnectorKey
  /** Stable key: zotero libraryID, eagle library path, obsidian vault path. */
  stableKey: string
  displayName: string
  availability: LibraryAvailability
  lastSeenAt: number | null
  lastScanAt: number | null
  documentCount: number
}

/** The `index:libraries` response: connector statuses + their libraries. */
export interface LibrariesSnapshot {
  connectors: { key: ConnectorKey; status: ConnectorStatus }[]
  libraries: LibraryInfo[]
}

// ── System: deep links out to the systems of record ──────────────────────────
export const SYSTEM_OPEN_CHANNEL = 'system:open'

/** Deep links may only target the known tools (plus http for future sources). */
const ALLOWED_URI = /^(zotero|eagle|obsidian|https?):/
export const systemOpenSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('uri'), value: z.string().regex(ALLOWED_URI) }),
  z.object({ kind: z.literal('path'), value: z.string().min(1) }),
  z.object({ kind: z.literal('reveal'), value: z.string().min(1) }),
])
export type SystemOpenRequest = z.infer<typeof systemOpenSchema>
