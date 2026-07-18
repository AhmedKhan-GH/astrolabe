import { index, integer, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core'

/**
 * Index schema v2 (spine spec v2, docs/2026-07-17). Everything here is DERIVED
 * and rebuildable from the systems of record (ADR-0005) — no user data lives only
 * here; reading ledgers and marks are hash-keyed files (spec §3), immune to
 * rebuilds. Convention: integer autoincrement `id` on every table (generic
 * dispatch + stable ids, docs/10 §9). Timestamps are epoch ms.
 *
 * v2 vs v1: the library level (spec §1). v1 modeled one corpus per connector and
 * treated a library switch as mass deletion; v2 scopes instances to a library,
 * scans and removal sweeps are library-scoped, and documents are PERMANENT — no
 * sync path deletes a document row (a zero-instance document is a ghost, spec §2).
 */

/** Real workspace bookkeeping (schema probes, sync markers). Not a demo table. */
export const meta = sqliteTable('meta', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  key: text('key').notNull().unique(),
  value: text('value').notNull(),
})
export type Meta = typeof meta.$inferSelect
export type NewMeta = typeof meta.$inferInsert

/** One row per connector: capability + status. (v1 called this `sources`.) */
export const connectors = sqliteTable('connectors', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  key: text('key').notNull().unique(), // 'zotero' | 'eagle' | 'obsidian'
  // 'denied' = configured but blocked by OS permissions (macOS TCC) — distinct
  // from 'unavailable' (tool not running / unconfigured) so the UI can offer a fix.
  status: text('status', { enum: ['ok', 'unavailable', 'denied', 'disabled'] })
    .notNull()
    .default('ok'),
})
export type Connector = typeof connectors.$inferSelect

/**
 * A corpus a connector can see (spec §1): zotero personal library and each
 * group library (stableKey = libraryID), an eagle library (stableKey = its
 * path), an obsidian vault (stableKey = vault path). Availability is the
 * presence rule (spec §2): `dormant` (unreachable) never deletes anything;
 * `gone` is an explicit user verdict, the only non-scan path that drops
 * instances. The sync cursor lives here, per-library (zotero groups version
 * independently).
 */
export const libraries = sqliteTable(
  'libraries',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    connectorId: integer('connector_id')
      .notNull()
      .references(() => connectors.id, { onDelete: 'cascade' }),
    stableKey: text('stable_key').notNull(),
    displayName: text('display_name').notNull(),
    availability: text('availability', { enum: ['live', 'dormant', 'gone'] })
      .notNull()
      .default('live'),
    syncCursor: text('sync_cursor'),
    lastSeenAt: integer('last_seen_at'),
    lastScanAt: integer('last_scan_at'),
  },
  (t) => [unique('libraries_connector_key_uq').on(t.connectorId, t.stableKey)],
)
export type Library = typeof libraries.$inferSelect

/**
 * The cross-source entity. `contentSha256` is the join key that merges the same
 * file held in two tools — or two libraries — into ONE document (the
 * Zotero↔Eagle pain-killer, spec §1). Nullable: mutable notes have no hash
 * identity (their anchor is their single instance's (library, relpath)).
 * PERMANENT: no sync path deletes a row here (spec §2 — ghosts, not prunes).
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

/**
 * A document as one LIBRARY holds it: the join to reality (provenance URI, file
 * path). v2: scoped to a library, not a connector — the unique key and every
 * removal sweep operate within one library (spec §2). Cascade from libraries is
 * intentional: only the `gone` verdict deletes a library row, and that verdict
 * means "drop these instances" (documents survive as ghosts).
 */
export const documentInstances = sqliteTable(
  'document_instances',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    documentId: integer('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    libraryId: integer('library_id')
      .notNull()
      .references(() => libraries.id, { onDelete: 'cascade' }),
    externalKey: text('external_key').notNull(), // zotero item key / eagle id / vault relpath
    uri: text('uri').notNull(), // zotero://… | eagle://… | obsidian://…
    filePath: text('file_path'),
    metaJson: text('meta_json'),
  },
  (t) => [
    unique('instances_library_external_uq').on(t.libraryId, t.externalKey),
    index('instances_document_idx').on(t.documentId),
    index('instances_library_idx').on(t.libraryId),
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

/** Source-owned collection/folder trees (Zotero collections, Eagle folders) —
 *  per-library in v2 (a Zotero group's collections are its own). */
export const collections = sqliteTable(
  'collections',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    libraryId: integer('library_id')
      .notNull()
      .references(() => libraries.id, { onDelete: 'cascade' }),
    externalKey: text('external_key').notNull(),
    name: text('name').notNull(),
    parentId: integer('parent_id'),
  },
  (t) => [unique('collections_library_external_uq').on(t.libraryId, t.externalKey)],
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
 * Human wiki-link edges (M2; quarried from v1). One row per (obsidian instance,
 * link target). `targetName` is the raw wiki-link text (before `|`/`#`);
 * `targetDocumentId` is the resolved document, recomputed wholesale each pass
 * by `resolveLinks` — SET NULL when the target is renamed/removed/ambiguous.
 * Rows are owned by the SOURCE instance (CASCADE), so a note leaving the index
 * drops its outlinks.
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

/** Zotero highlights/notes (and later any source's annotations), page-anchored.
 *  Instance-scoped: an annotation belongs to the copy that carries it. */
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

// Deferred to their milestones (spine spec §6): links (M2, obsidian wiki-links),
// virtual collections (M6). The reading ledger is files, never tables (spec §3).
