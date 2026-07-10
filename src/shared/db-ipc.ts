import { z } from 'zod'

/**
 * Wire contract for the generic typed table-client (salvage-manifest pattern,
 * runway spec step 2). Recorded ceiling (docs/01 audit): FTS, joins, and
 * transactions never go through this channel — they get named channels
 * (`index:search`, `index:rebuild`, steps 3/6).
 */
export const DB_CHANNEL = 'db:query'
export const INDEX_SEARCH_CHANNEL = 'index:search'
export const INDEX_SYNC_CHANNEL = 'index:sync'
export const INDEX_REBUILD_CHANNEL = 'index:rebuild'
// Library Navigator (docs/2026-07-10): the river + rail read paths — joins, so named
// channels (docs/01 ceiling: they never ride the generic table-client).
export const INDEX_BROWSE_CHANNEL = 'index:browse'
export const INDEX_NAV_CHANNEL = 'index:nav'

const row = z.record(z.string(), z.unknown())
const id = z.number().int().positive()

export const INDEX_SOURCES_CHANNEL = 'index:sources'
export const INDEX_STATS_CHANNEL = 'index:stats'
export const SYSTEM_OPEN_CHANNEL = 'system:open'
export const SYSTEM_REQUEST_ACCESS_CHANNEL = 'system:request-access'

/** Grant-access probe (macOS TCC): only the known sources are probeable. */
export const requestAccessSchema = z.object({
  sourceKey: z.enum(['zotero', 'eagle', 'obsidian']),
})
export type RequestAccessRequest = z.infer<typeof requestAccessSchema>

/** Deep links may only target the known tools (plus http for future sources). */
const ALLOWED_URI = /^(zotero|eagle|obsidian|https?):/
export const systemOpenSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('uri'), value: z.string().regex(ALLOWED_URI) }),
  z.object({ kind: z.literal('path'), value: z.string().min(1) }),
  z.object({ kind: z.literal('reveal'), value: z.string().min(1) }),
])
export type SystemOpenRequest = z.infer<typeof systemOpenSchema>

export const dbRequestSchema = z.discriminatedUnion('op', [
  z.object({ table: z.string(), op: z.literal('getAll') }),
  z.object({ table: z.string(), op: z.literal('getById'), id }),
  z.object({ table: z.string(), op: z.literal('create'), values: row }),
  z.object({ table: z.string(), op: z.literal('update'), id, values: row }),
  z.object({ table: z.string(), op: z.literal('delete'), id }),
])
export type DbRequest = z.infer<typeof dbRequestSchema>
