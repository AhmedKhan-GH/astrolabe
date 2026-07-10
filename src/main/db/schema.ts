import { index, integer, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core'

/**
 * Index schema v1 (runway step 3; docs/03 Layer 3–4). Everything here is DERIVED
 * and rebuildable from the systems of record (ADR-0005) — no user data lives only
 * here. Convention: integer autoincrement `id` on every table (generic dispatch
 * + stable ids, docs/10 §9). Timestamps are epoch ms.
 */

/** Real workspace bookkeeping (schema probes, sync markers). Not a demo table. */
export const meta = sqliteTable('meta', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  key: text('key').notNull().unique(),
  value: text('value').notNull(),
})
export type Meta = typeof meta.$inferSelect
export type NewMeta = typeof meta.$inferInsert

/** One row per connector; status + incremental cursor. */
export const sources = sqliteTable('sources', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  key: text('key').notNull().unique(), // 'zotero' | 'eagle' | 'obsidian' | 'goodnotes'
  // 'denied' = configured but blocked by OS permissions (macOS TCC) — distinct
  // from 'unavailable' (tool not running / unconfigured) so the UI can offer a fix.
  status: text('status', { enum: ['ok', 'unavailable', 'denied', 'disabled'] })
    .notNull()
    .default('ok'),
  syncCursor: text('sync_cursor'),
  lastSyncAt: integer('last_sync_at'),
})
export type Source = typeof sources.$inferSelect

/**
 * The cross-source entity. `contentSha256` is the join key that merges the same
 * file held in two tools into ONE document (the Zotero↔Eagle pain-killer).
 */
export const documents = sqliteTable(
  'documents',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    contentSha256: text('content_sha256').unique(),
    title: text('title').notNull(),
    kind: text('kind', { enum: ['pdf', 'image', 'note', 'other'] }).notNull(),
    createdAt: integer('created_at').notNull(),
    modifiedAt: integer('modified_at').notNull(),
  },
  (t) => [index('documents_title_idx').on(t.title)],
)
export type Document = typeof documents.$inferSelect

/** A document as one source sees it: the join to reality (provenance URI, file path). */
export const documentInstances = sqliteTable(
  'document_instances',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    documentId: integer('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    sourceId: integer('source_id')
      .notNull()
      .references(() => sources.id, { onDelete: 'cascade' }),
    externalKey: text('external_key').notNull(), // zotero item key / eagle id / vault relpath
    uri: text('uri').notNull(), // zotero://… | eagle://… | obsidian://…
    filePath: text('file_path'),
    metaJson: text('meta_json'),
  },
  (t) => [
    unique('instances_source_external_uq').on(t.sourceId, t.externalKey),
    index('instances_document_idx').on(t.documentId),
  ],
)
export type DocumentInstance = typeof documentInstances.$inferSelect

export const tags = sqliteTable('tags', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
})

export const documentTags = sqliteTable(
  'document_tags',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    documentId: integer('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    tagId: integer('tag_id')
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
  },
  (t) => [unique('document_tags_uq').on(t.documentId, t.tagId)],
)

/** Source-owned collection/folder trees (Zotero collections, Eagle folders). */
export const collections = sqliteTable(
  'collections',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    sourceId: integer('source_id')
      .notNull()
      .references(() => sources.id, { onDelete: 'cascade' }),
    externalKey: text('external_key').notNull(),
    name: text('name').notNull(),
    parentId: integer('parent_id'),
  },
  (t) => [unique('collections_source_external_uq').on(t.sourceId, t.externalKey)],
)

export const documentCollections = sqliteTable(
  'document_collections',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    documentId: integer('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    collectionId: integer('collection_id')
      .notNull()
      .references(() => collections.id, { onDelete: 'cascade' }),
  },
  (t) => [unique('document_collections_uq').on(t.documentId, t.collectionId)],
)

/**
 * Virtual collections (docs/2026-07-10-lens-virtual-collections-spec) — the derived MIRROR of
 * the user-owned files at `<workspace>/.astrolabe/collections/<slug>.json`. Files are truth;
 * these tables exist only so SQL (counts, facet filtering, browse/search scope) can join against
 * membership. Rebuilt wholesale from the files by `syncVirtualCollections`.
 */
export const virtualCollections = sqliteTable('virtual_collections', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
})

/** M:N membership. `documentId` cascades: a document leaving the index drops its memberships;
 *  a hash-first ref in the file re-materialises the row on the next re-mirror. */
export const virtualCollectionMembers = sqliteTable(
  'virtual_collection_members',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    vcId: integer('vc_id')
      .notNull()
      .references(() => virtualCollections.id, { onDelete: 'cascade' }),
    documentId: integer('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
  },
  (t) => [
    unique('vc_members_uq').on(t.vcId, t.documentId),
    index('vc_members_document_idx').on(t.documentId),
  ],
)

/**
 * Human wiki-link edges (docs/2026-07-10 notes wave §Links). One row per (obsidian instance,
 * link target). `targetName` is the raw wiki-link text (before `|`/`#`); `targetDocumentId` is
 * the resolved document, recomputed wholesale each pass by `resolveLinks` — SET NULL when the
 * target is renamed/removed/ambiguous. Rows are owned by the SOURCE instance (CASCADE), so a
 * note leaving the index drops its outlinks.
 */
export const links = sqliteTable(
  'links',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    sourceInstanceId: integer('source_instance_id')
      .notNull()
      .references(() => documentInstances.id, { onDelete: 'cascade' }),
    targetName: text('target_name').notNull(),
    targetDocumentId: integer('target_document_id').references(() => documents.id, {
      onDelete: 'set null',
    }),
  },
  (t) => [
    unique('links_source_target_uq').on(t.sourceInstanceId, t.targetName),
    index('links_target_document_idx').on(t.targetDocumentId),
  ],
)
export type Link = typeof links.$inferSelect

/** Zotero highlights/notes (and later any source's annotations), page-anchored. */
export const annotations = sqliteTable(
  'annotations',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    instanceId: integer('instance_id')
      .notNull()
      .references(() => documentInstances.id, { onDelete: 'cascade' }),
    externalKey: text('external_key').notNull(),
    type: text('type').notNull(), // highlight | note | ink | image
    text: text('text'),
    comment: text('comment'),
    pageLabel: text('page_label'),
    color: text('color'),
    positionJson: text('position_json'),
    modifiedAt: integer('modified_at').notNull(),
  },
  (t) => [
    unique('annotations_instance_external_uq').on(t.instanceId, t.externalKey),
    index('annotations_instance_idx').on(t.instanceId),
  ],
)
export type Annotation = typeof annotations.$inferSelect
