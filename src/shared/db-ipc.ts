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
// Canvas view (docs/2026-07-10-canvas-view-spec §Page-annotation heat): per-page annotation
// counts for one document — a join + json_extract aggregation, so a named channel too. The
// request schema lives with the query module (queries.ts), like search/browse.
export const INDEX_PAGE_ANNOTATIONS_CHANNEL = 'index:page-annotations'

const row = z.record(z.string(), z.unknown())
const id = z.number().int().positive()

export const INDEX_SOURCES_CHANNEL = 'index:sources'
export const INDEX_STATS_CHANNEL = 'index:stats'
export const SYSTEM_OPEN_CHANNEL = 'system:open'
export const SYSTEM_REQUEST_ACCESS_CHANNEL = 'system:request-access'

// Saved views (docs/2026-07-10-lens-saved-views-spec): named lenses persisted as one JSON file
// per view under `<workspace>/.astrolabe/views/`. list → SavedView[]; save({name,q?,filter}) →
// SavedView; delete({slug}) → boolean. The save request + file schemas live WITH the module
// (`src/main/lib/views.ts`), not here: they embed `storedFilterSchema`, which derives from
// `filterSetSchema` (main/index/queries.ts) — importing it into this shared file would invert
// the layer direction and drag drizzle into the preload bundle. Only the layer-free `{slug}`
// delete request stays here, alongside the channel names.
export const VIEWS_LIST_CHANNEL = 'views:list'
export const VIEWS_SAVE_CHANNEL = 'views:save'
export const VIEWS_DELETE_CHANNEL = 'views:delete'

/** A view is addressed by its slug (the file basename); the only field delete needs. */
export const deleteViewRequestSchema = z.object({ slug: z.string().min(1).max(200) })
export type DeleteViewRequest = z.infer<typeof deleteViewRequestSchema>

// Virtual collections (docs/2026-07-10-lens-virtual-collections-spec): M:N, source-independent
// grouping persisted as one JSON file per collection under `<workspace>/.astrolabe/collections/`.
// list → summaries; create({name}) upserts by slug; delete({slug}); add/remove-members take
// document ids (main converts ids ↔ refs). Unlike saved views these request schemas are all
// layer-free (name / slug / document ids — no `filterSetSchema` reach), so they live here beside
// the channel names rather than dragging drizzle into the preload bundle.
export const VCOLLECTIONS_LIST_CHANNEL = 'vcollections:list'
export const VCOLLECTIONS_CREATE_CHANNEL = 'vcollections:create'
export const VCOLLECTIONS_DELETE_CHANNEL = 'vcollections:delete'
export const VCOLLECTIONS_ADD_MEMBERS_CHANNEL = 'vcollections:add-members'
export const VCOLLECTIONS_REMOVE_MEMBERS_CHANNEL = 'vcollections:remove-members'

/** Create request: only the display name; the slug + createdAt are derived server-side. */
export const createVCollectionRequestSchema = z.object({ name: z.string().min(1).max(120) })
export type CreateVCollectionRequest = z.infer<typeof createVCollectionRequestSchema>

/** Delete: addressed by slug (the file basename), like a saved view. */
export const deleteVCollectionRequestSchema = z.object({ slug: z.string().min(1).max(200) })
export type DeleteVCollectionRequest = z.infer<typeof deleteVCollectionRequestSchema>

/** Add/remove members: the target slug plus the affected document ids (main resolves ids ↔ refs). */
export const vcollectionMembersRequestSchema = z.object({
  slug: z.string().min(1).max(200),
  documentIds: z.array(id).max(10_000),
})
export type VCollectionMembersRequest = z.infer<typeof vcollectionMembersRequestSchema>

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
