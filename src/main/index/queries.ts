import { eq, sql, type SQL } from 'drizzle-orm'
import { z } from 'zod'
import type { Db } from '../db'
import * as s from '../db/schema'
import { buildCollectionTree, buildFolderTree, type NavNode } from './nav-tree'
import { documentLinks, type BackLink } from './links'

/**
 * Read path over the index (runway step 3; grows in step 6, reused verbatim by the
 * step-7 MCP server — this module is the first draft of Alioth's context assembler).
 * Named-channel territory: FTS + joins deliberately bypass the generic table-client.
 */

/** The Library Navigator selection dimensions (docs/2026-07-10-lens-boolean-filtering-spec).
 *  Dimensions AND together; within a dimension selection is a union (OR), with tags carrying
 *  the ALL/ANY/NONE boolean structure. All fields optional — the empty set is no constraint,
 *  and the MCP server's `{q, limit}` calls stay valid. Shared verbatim by browse and search. */
export const filterSetSchema = z.object({
  sourceKeys: z.array(z.enum(['zotero', 'eagle', 'obsidian'])).max(3).optional(),
  collectionIds: z.array(z.number().int().positive()).max(100).optional(),
  folderPrefixes: z.array(z.string().max(500)).max(50).optional(), // externalKey LIKE '<p>%', obsidian-scoped
  // Virtual-collection slugs (docs/2026-07-10-lens-virtual-collections). Rebuild-stable, so a
  // StoredFilter passes them through verbatim — saved views compose with virtual collections.
  virtualCollections: z.array(z.string().max(140)).max(50).optional(),
  kinds: z.array(z.enum(['pdf', 'image', 'note', 'other'])).max(4).optional(),
  tagsAll: z.array(z.string().max(200)).max(50).optional(),
  tagsAny: z.array(z.string().max(200)).max(50).optional(),
  tagsNone: z.array(z.string().max(200)).max(50).optional(),
  // Presence: the zotero↔eagle split as its own AND-dimension (docs/2026-07-10-lens-presence-facet).
  // Z = a zotero instance exists, E = an eagle instance exists; both = Z∧E, zotero-only = Z∧¬E,
  // eagle-only = E∧¬Z. Internal OR like every array; NOT part of the scope union.
  presence: z.array(z.enum(['both', 'zotero-only', 'eagle-only'])).max(3).optional(),
})
export type FilterSet = z.infer<typeof filterSetSchema>

export const searchRequestSchema = z.object({
  q: z.string().min(1).max(500),
  limit: z.number().int().positive().max(200).default(50),
  ...filterSetSchema.shape,
})
export type SearchRequest = z.infer<typeof searchRequestSchema>

/** Per-page annotation heat for one document (docs/2026-07-10 canvas spec §Page-annotation heat). */
export const pageAnnotationsRequestSchema = z.object({ documentId: z.number().int().positive() })
export type PageAnnotationsRequest = z.infer<typeof pageAnnotationsRequestSchema>

export interface PageAnnotations {
  pages: { pageIndex: number; count: number }[]
}

/** Browse (the recency river) — same filters as search minus `q`, plus offset paging. */
export const browseRequestSchema = z.object({
  ...filterSetSchema.shape,
  offset: z.number().int().min(0).default(0),
  limit: z.number().int().positive().max(200).default(100),
})
export type BrowseRequest = z.infer<typeof browseRequestSchema>

export interface BrowseHit {
  documentId: number
  title: string
  kind: string
  modifiedAt: number
  tags: string[]
  // `instanceId` is the handle the Canvas view serves bytes by (astro://doc/<id>,
  // docs/2026-07-10-canvas-view-spec §Serving PDF bytes) — the renderer never sees a path scheme.
  // `openPdfUri` is the page-targetable zotero base (null unless the instance carries an
  // attachmentKey) — the renderer appends the clicked page to deep-link into the reader.
  instances: {
    instanceId: number
    sourceKey: string
    uri: string
    filePath: string | null
    openPdfUri: string | null
  }[]
  // Virtual-collection slugs this document belongs to (from `hydrate`) — drives the river's
  // membership-popover checked state (docs/2026-07-10-lens-virtual-collections §Wire contract).
  virtualCollections: string[]
}
export interface BrowsePage {
  total: number
  hits: BrowseHit[]
}

export interface NavSource {
  key: string
  status: string
  documentCount: number
  tree: NavNode[]
}
export interface NavData {
  kinds: { kind: string; count: number }[]
  sources: NavSource[]
  tags: { name: string; count: number }[]
  virtualCollections: { slug: string; name: string; count: number }[]
  // The three presence buckets (docs/2026-07-10-lens-presence-facet), computed with the same
  // Z/E predicates the filter uses — the always-three rows the rail's Presence section renders.
  presence: { value: PresenceValue; count: number }[]
}

export interface SearchHit {
  documentId: number
  title: string
  kind: string
  snippet: string
  tags: string[]
  instances: {
    instanceId: number
    sourceKey: string
    uri: string
    filePath: string | null
    openPdfUri: string | null
  }[]
  virtualCollections: string[]
}

/**
 * The Document Hub payload (docs/2026-07-10-implementation-plan-notes-hub-ink §Step 2): one
 * document's full detail composed from the existing helpers in a single round-trip — core,
 * per-source instances (from `hydrate`), tags, virtual-collection memberships (slugs joined to
 * names), the annotation summary (total + the `pageAnnotations` per-page counts), backlinking
 * notes (from `documentLinks`), and the zotero↔eagle presence derived from the instances.
 */
export interface DocumentDetail {
  documentId: number
  title: string
  kind: string
  modifiedAt: number
  tags: string[]
  instances: {
    instanceId: number
    sourceKey: string
    uri: string
    filePath: string | null
    openPdfUri: string | null
  }[]
  virtualCollections: { slug: string; name: string }[]
  annotations: { total: number; pages: { pageIndex: number; count: number }[] }
  /** 'none' = neither a zotero nor an eagle instance exists (e.g. an obsidian-only note). */
  presence: PresenceValue | 'none'
  backlinks: BackLink[]
}

/** A drizzle IN-list body: `?, ?, …` bound one placeholder per value (goes inside `IN (...)`). */
const inList = (values: (string | number)[]): SQL =>
  sql.join(
    values.map((v) => sql`${v}`),
    sql`, `,
  )

type PresenceValue = 'both' | 'zotero-only' | 'eagle-only'

/**
 * Page-targetable open-pdf base from an instance's metaJson attachmentKey, or null. The key
 * is captured at sync time by the zotero connector (src/main/connectors/zotero/mapping.ts,
 * which owns the `zoteroOpenPdfUri` helper); the template is inlined here so the read path
 * never imports connector code. The renderer appends the clicked page to this base.
 */
function openPdfUriFromMeta(metaJson: string | null): string | null {
  if (!metaJson) return null
  try {
    const parsed = JSON.parse(metaJson) as { attachmentKey?: unknown }
    if (typeof parsed.attachmentKey === 'string' && parsed.attachmentKey)
      return `zotero://open-pdf/library/items/${parsed.attachmentKey}`
    return null
  } catch {
    return null
  }
}

/** "A zotero / an eagle instance exists for the aliased `documents d`." (presence facet). */
const zExists = sql`EXISTS (SELECT 1 FROM document_instances di JOIN sources src ON di.source_id = src.id
                    WHERE di.document_id = d.id AND src.key = 'zotero')`
const eExists = sql`EXISTS (SELECT 1 FROM document_instances di JOIN sources src ON di.source_id = src.id
                    WHERE di.document_id = d.id AND src.key = 'eagle')`

/** The presence predicate for one value, over aliased `documents d` (wrapped for OR-safety). */
const presencePredicate = (v: PresenceValue): SQL => {
  switch (v) {
    case 'both':
      return sql`(${zExists} AND ${eExists})`
    case 'zotero-only':
      return sql`(${zExists} AND NOT ${eExists})`
    case 'eagle-only':
      return sql`(${eExists} AND NOT ${zExists})`
  }
}

export function createIndexQueries(db: Db) {
  /**
   * The FilterSet as SQL predicates over an aliased `documents d`, one-row-per-document via
   * EXISTS (never JOIN+DISTINCT). Dimensions AND together; the returned array is AND-joined by
   * the caller (docs/2026-07-10-lens-boolean-filtering-spec §SQL). folderPrefixes are scoped to
   * obsidian instances (the vault relpath is that source's externalKey).
   */
  function filterConditions(f: FilterSet): SQL[] {
    const conds: SQL[] = []

    // Scope is the union of its non-empty sub-predicates: a document matches if it lives in any
    // selected source, any selected collection, or under any selected obsidian folder prefix.
    const scope: SQL[] = []
    if (f.sourceKeys?.length)
      scope.push(
        sql`EXISTS (SELECT 1 FROM document_instances di JOIN sources src ON di.source_id = src.id
                    WHERE di.document_id = d.id AND src.key IN (${inList(f.sourceKeys)}))`,
      )
    if (f.collectionIds?.length)
      scope.push(
        sql`EXISTS (SELECT 1 FROM document_collections dc
                    WHERE dc.document_id = d.id AND dc.collection_id IN (${inList(f.collectionIds)}))`,
      )
    if (f.folderPrefixes?.length) {
      const anyPrefix = sql.join(
        f.folderPrefixes.map((p) => sql`di.external_key LIKE ${p + '%'}`),
        sql` OR `,
      )
      scope.push(
        sql`EXISTS (SELECT 1 FROM document_instances di JOIN sources src ON di.source_id = src.id
                    WHERE di.document_id = d.id AND src.key = 'obsidian' AND (${anyPrefix}))`,
      )
    }
    if (f.virtualCollections?.length)
      scope.push(
        sql`EXISTS (SELECT 1 FROM virtual_collection_members vm JOIN virtual_collections vc ON vm.vc_id = vc.id
                    WHERE vm.document_id = d.id AND vc.slug IN (${inList(f.virtualCollections)}))`,
      )
    if (scope.length) conds.push(sql`(${sql.join(scope, sql` OR `)})`)

    // Kind is one of the selected kinds.
    if (f.kinds?.length) conds.push(sql`d.kind IN (${inList(f.kinds)})`)

    // tagsAll: the document carries every named tag — one EXISTS per tag, AND-joined.
    for (const tag of f.tagsAll ?? [])
      conds.push(
        sql`EXISTS (SELECT 1 FROM document_tags dt JOIN tags t ON dt.tag_id = t.id
                    WHERE dt.document_id = d.id AND t.name = ${tag})`,
      )

    // tagsAny: the document carries at least one named tag.
    if (f.tagsAny?.length)
      conds.push(
        sql`EXISTS (SELECT 1 FROM document_tags dt JOIN tags t ON dt.tag_id = t.id
                    WHERE dt.document_id = d.id AND t.name IN (${inList(f.tagsAny)}))`,
      )

    // tagsNone: the document carries none of the named tags.
    if (f.tagsNone?.length)
      conds.push(
        sql`NOT EXISTS (SELECT 1 FROM document_tags dt JOIN tags t ON dt.tag_id = t.id
                        WHERE dt.document_id = d.id AND t.name IN (${inList(f.tagsNone)}))`,
      )

    // Presence: an own AND-dimension over zotero/eagle instance existence — internal OR of the
    // selected values, and never folded into the scope union above.
    if (f.presence?.length)
      conds.push(sql`(${sql.join(f.presence.map(presencePredicate), sql` OR `)})`)

    return conds
  }

  /** A document's tags + per-source provenance + virtual-collection memberships — the shared
   *  tail of a search/browse hit. */
  function hydrate(documentId: number): Pick<BrowseHit, 'tags' | 'instances' | 'virtualCollections'> {
    const instanceRows = db
      .select({
        instanceId: s.documentInstances.id,
        sourceKey: s.sources.key,
        uri: s.documentInstances.uri,
        filePath: s.documentInstances.filePath,
        metaJson: s.documentInstances.metaJson,
      })
      .from(s.documentInstances)
      .innerJoin(s.sources, eq(s.documentInstances.sourceId, s.sources.id))
      .where(eq(s.documentInstances.documentId, documentId))
      .all()
    const instances = instanceRows.map(({ metaJson, ...rest }) => ({
      ...rest,
      openPdfUri: openPdfUriFromMeta(metaJson),
    }))
    const tagRows = db
      .select({ name: s.tags.name })
      .from(s.tags)
      .innerJoin(s.documentTags, eq(s.documentTags.tagId, s.tags.id))
      .where(eq(s.documentTags.documentId, documentId))
      .all()
    const vcRows = db
      .select({ slug: s.virtualCollections.slug })
      .from(s.virtualCollections)
      .innerJoin(s.virtualCollectionMembers, eq(s.virtualCollectionMembers.vcId, s.virtualCollections.id))
      .where(eq(s.virtualCollectionMembers.documentId, documentId))
      .orderBy(s.virtualCollections.slug)
      .all()
    return {
      tags: tagRows.map((t) => t.name),
      instances,
      virtualCollections: vcRows.map((v) => v.slug),
    }
  }

  function search(raw: unknown): SearchHit[] {
    const req = searchRequestSchema.parse(raw)
    // FTS5 MATCH first (bm25 ranking; snippet from body else title), THEN narrow via the
    // same joins as browse — the FTS table stays unaliased so bm25()/snippet() bind to it,
    // and `documents d` rides along for the selection predicates (docs/2026-07-10 §index:search).
    const conds = filterConditions(req)
    const where = conds.length ? sql` AND ${sql.join(conds, sql` AND `)}` : sql``
    const rows = db.all<{ rowid: number; snippet: string }>(
      sql`SELECT search_fts.rowid AS rowid, snippet(search_fts, 1, '⟪', '⟫', '…', 18) AS snippet
          FROM search_fts JOIN documents d ON d.id = search_fts.rowid
          WHERE search_fts MATCH ${req.q}${where}
          ORDER BY bm25(search_fts) LIMIT ${req.limit}`,
    )
    return rows.flatMap((r) => {
      const doc = db.select().from(s.documents).where(eq(s.documents.id, r.rowid)).get()
      if (!doc) return []
      return [{ documentId: doc.id, title: doc.title, kind: doc.kind, snippet: r.snippet, ...hydrate(doc.id) }]
    })
  }

  /**
   * The recency river (docs/2026-07-10 §index:browse): the filtered, newest-first document
   * page plus the total filtered distinct-document count (drives the virtualizer size).
   * Offset paging — at 10³–10⁴ docs SQLite offset cost is irrelevant and keyset is YAGNI.
   */
  function browse(raw: unknown): BrowsePage {
    const req = browseRequestSchema.parse(raw)
    const conds = filterConditions(req)
    const where = conds.length ? sql`WHERE ${sql.join(conds, sql` AND `)}` : sql``
    const total =
      db.get<{ c: number }>(sql`SELECT count(*) AS c FROM documents d ${where}`)?.c ?? 0
    const rows = db.all<{ id: number; title: string; kind: string; modifiedAt: number }>(
      sql`SELECT d.id AS id, d.title AS title, d.kind AS kind, d.modified_at AS modifiedAt
          FROM documents d ${where}
          ORDER BY d.modified_at DESC, d.id DESC
          LIMIT ${req.limit} OFFSET ${req.offset}`,
    )
    const hits = rows.map((r) => ({
      documentId: r.id,
      title: r.title,
      kind: r.kind,
      modifiedAt: r.modifiedAt,
      ...hydrate(r.id),
    }))
    return { total, hits }
  }

  /**
   * The nav-rail payload in one call (docs/2026-07-10 §index:nav): index-wide kind counts,
   * per-source status + distinct doc totals + a browse tree, and every tag by descending
   * count. Trees: zotero/eagle from `collections` (direct-membership counts, built by
   * nav-tree), obsidian derived from instance relpaths.
   */
  function nav(): NavData {
    const kinds = db.all<{ kind: string; count: number }>(
      sql`SELECT kind, count(*) AS count FROM documents GROUP BY kind ORDER BY count DESC, kind ASC`,
    )
    const tags = db.all<{ name: string; count: number }>(
      sql`SELECT t.name AS name, count(DISTINCT dt.document_id) AS count
          FROM tags t JOIN document_tags dt ON dt.tag_id = t.id
          GROUP BY t.id ORDER BY count DESC, t.name ASC`,
    )
    const sources: NavSource[] = db
      .select()
      .from(s.sources)
      .all()
      .map((src) => {
        const documentCount =
          db
            .select({ c: sql<number>`count(distinct ${s.documentInstances.documentId})` })
            .from(s.documentInstances)
            .where(eq(s.documentInstances.sourceId, src.id))
            .get()?.c ?? 0
        return { key: src.key, status: src.status, documentCount, tree: sourceTree(src) }
      })
    // Virtual collections carry their (distinct-document) member count; a LEFT JOIN keeps an
    // empty collection at count 0. Name-sorted for the rail (spec §Wire contract).
    const virtualCollections = db.all<{ slug: string; name: string; count: number }>(
      sql`SELECT vc.slug AS slug, vc.name AS name, count(vm.document_id) AS count
          FROM virtual_collections vc
          LEFT JOIN virtual_collection_members vm ON vm.vc_id = vc.id
          GROUP BY vc.id ORDER BY vc.name ASC`,
    )
    // Presence buckets — one scan over documents, each row tallied into at most one bucket by the
    // same Z/E predicates the filter uses (obsidian-only rows fall into none). Always three rows.
    const p = db.get<{ both: number; zoteroOnly: number; eagleOnly: number }>(
      sql`SELECT
            sum(CASE WHEN ${zExists} AND ${eExists} THEN 1 ELSE 0 END) AS both,
            sum(CASE WHEN ${zExists} AND NOT ${eExists} THEN 1 ELSE 0 END) AS zoteroOnly,
            sum(CASE WHEN ${eExists} AND NOT ${zExists} THEN 1 ELSE 0 END) AS eagleOnly
          FROM documents d`,
    )
    const presence: NavData['presence'] = [
      { value: 'both', count: p?.both ?? 0 },
      { value: 'zotero-only', count: p?.zoteroOnly ?? 0 },
      { value: 'eagle-only', count: p?.eagleOnly ?? 0 },
    ]
    return { kinds, sources, tags, virtualCollections, presence }
  }

  /** Obsidian browses by folder relpath; zotero/eagle (and any other source) by collections. */
  function sourceTree(src: s.Source): NavNode[] {
    if (src.key === 'obsidian') {
      const relPaths = db
        .select({ externalKey: s.documentInstances.externalKey })
        .from(s.documentInstances)
        .where(eq(s.documentInstances.sourceId, src.id))
        .all()
        .map((r) => r.externalKey)
      return buildFolderTree(relPaths)
    }
    const rows = db
      .select({
        id: s.collections.id,
        name: s.collections.name,
        parentId: s.collections.parentId,
        // externalKey rides along so nav nodes carry the rebuild-stable collection key that
        // saved views persist (the regenerated `id` is unsafe across a rebuild).
        externalKey: s.collections.externalKey,
      })
      .from(s.collections)
      .where(eq(s.collections.sourceId, src.id))
      .all()
    const counts = db.all<{ collectionId: number; count: number }>(
      sql`SELECT dc.collection_id AS collectionId, count(DISTINCT dc.document_id) AS count
          FROM document_collections dc JOIN collections c ON c.id = dc.collection_id
          WHERE c.source_id = ${src.id} GROUP BY dc.collection_id`,
    )
    return buildCollectionTree(rows, new Map(counts.map((c) => [c.collectionId, c.count])))
  }

  /** Per-source status + document totals (drives the lens status strip and the
   *  MCP `list_sources` tool). Totals are index-wide, not per-sync-run — a
   *  no-change incremental sync must not read as an empty index. */
  function sourceSummaries(): SourceSummary[] {
    const sources = db.select().from(s.sources).all()
    return sources.map((src) => {
      const counted = db
        .select({ count: sql<number>`count(distinct ${s.documentInstances.documentId})` })
        .from(s.documentInstances)
        .where(eq(s.documentInstances.sourceId, src.id))
        .get()
      return {
        key: src.key,
        status: src.status,
        lastSyncAt: src.lastSyncAt,
        documentCount: counted?.count ?? 0,
      }
    })
  }

  /** Index-wide totals for the always-on stats strip. `documents` is the DISTINCT
   *  document count (the `documents` table already merges cross-source duplicates
   *  into one row), so it stays correct once Eagle↔Zotero joins land — unlike
   *  summing per-source counts, which would double-count a joined document. */
  function indexStats(): IndexStats {
    const documents = db.select({ c: sql<number>`count(*)` }).from(s.documents).get()
    const annotations = db.select({ c: sql<number>`count(*)` }).from(s.annotations).get()
    return { documents: documents?.c ?? 0, annotations: annotations?.c ?? 0 }
  }

  /**
   * Per-page annotation counts for the Canvas heat layer (docs/2026-07-10 §Page-annotation heat):
   * `json_extract(position_json, '$.position.pageIndex')` over every annotation of the document's
   * instances (so a hash-joined doc sums across sources), grouped and ordered by pageIndex; rows
   * with a null/absent pageIndex are dropped.
   */
  function pageAnnotations(raw: unknown): PageAnnotations {
    const req = pageAnnotationsRequestSchema.parse(raw)
    const pages = db.all<{ pageIndex: number; count: number }>(
      sql`SELECT json_extract(a.position_json, '$.position.pageIndex') AS pageIndex,
                 count(*) AS count
          FROM annotations a
          JOIN document_instances di ON di.id = a.instance_id
          WHERE di.document_id = ${req.documentId}
            AND json_extract(a.position_json, '$.position.pageIndex') IS NOT NULL
          GROUP BY pageIndex
          ORDER BY pageIndex ASC`,
    )
    return { pages }
  }

  /**
   * The Document Hub payload (docs/2026-07-10-implementation-plan-notes-hub-ink §Step 2). Composes
   * the existing read helpers in one call: `hydrate` for instances + tags, a vc join for
   * membership names, `pageAnnotations` for per-page heat, `documentLinks` for backlinks, and the
   * instances' source keys for the presence facet. Returns null when the document does not exist.
   */
  function documentDetail(documentId: number): DocumentDetail | null {
    const doc = db.select().from(s.documents).where(eq(s.documents.id, documentId)).get()
    if (!doc) return null
    const { tags, instances } = hydrate(documentId)
    // Slugs joined to names — hydrate carries slugs only; the hub labels the chips.
    const virtualCollections = db
      .select({ slug: s.virtualCollections.slug, name: s.virtualCollections.name })
      .from(s.virtualCollections)
      .innerJoin(s.virtualCollectionMembers, eq(s.virtualCollectionMembers.vcId, s.virtualCollections.id))
      .where(eq(s.virtualCollectionMembers.documentId, documentId))
      .orderBy(s.virtualCollections.slug)
      .all()
    const pages = pageAnnotations({ documentId }).pages
    // Total counts every annotation of the document's instances (not just page-anchored ones).
    const total =
      db.get<{ c: number }>(
        sql`SELECT count(*) AS c FROM annotations a
            JOIN document_instances di ON di.id = a.instance_id
            WHERE di.document_id = ${documentId}`,
      )?.c ?? 0
    // Presence from the already-hydrated instances (same Z/E rule the facet uses).
    const hasZ = instances.some((i) => i.sourceKey === 'zotero')
    const hasE = instances.some((i) => i.sourceKey === 'eagle')
    const presence: DocumentDetail['presence'] =
      hasZ && hasE ? 'both' : hasZ ? 'zotero-only' : hasE ? 'eagle-only' : 'none'
    const backlinks = documentLinks(db, documentId).backlinks
    return {
      documentId: doc.id,
      title: doc.title,
      kind: doc.kind,
      modifiedAt: doc.modifiedAt,
      tags,
      instances,
      virtualCollections,
      annotations: { total, pages },
      presence,
      backlinks,
    }
  }

  return { search, browse, nav, sourceSummaries, indexStats, pageAnnotations, documentDetail }
}

export interface IndexStats {
  documents: number
  annotations: number
}

export interface SourceSummary {
  key: string
  status: string
  lastSyncAt: number | null
  documentCount: number
}

export type IndexQueries = ReturnType<typeof createIndexQueries>
