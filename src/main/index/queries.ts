import { eq, sql, type SQL } from 'drizzle-orm'
import { z } from 'zod'
import type { Db } from '../db'
import * as s from '../db/schema'
import { buildCollectionTree, buildFolderTree, type NavNode } from './nav-tree'

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
  kinds: z.array(z.enum(['pdf', 'image', 'note', 'other'])).max(4).optional(),
  tagsAll: z.array(z.string().max(200)).max(50).optional(),
  tagsAny: z.array(z.string().max(200)).max(50).optional(),
  tagsNone: z.array(z.string().max(200)).max(50).optional(),
})
export type FilterSet = z.infer<typeof filterSetSchema>

export const searchRequestSchema = z.object({
  q: z.string().min(1).max(500),
  limit: z.number().int().positive().max(200).default(50),
  ...filterSetSchema.shape,
})
export type SearchRequest = z.infer<typeof searchRequestSchema>

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
  instances: { sourceKey: string; uri: string; filePath: string | null }[]
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
}

export interface SearchHit {
  documentId: number
  title: string
  kind: string
  snippet: string
  tags: string[]
  instances: { sourceKey: string; uri: string; filePath: string | null }[]
}

/** A drizzle IN-list body: `?, ?, …` bound one placeholder per value (goes inside `IN (...)`). */
const inList = (values: (string | number)[]): SQL =>
  sql.join(
    values.map((v) => sql`${v}`),
    sql`, `,
  )

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

    return conds
  }

  /** A document's tags + per-source provenance — the shared tail of a search/browse hit. */
  function hydrate(documentId: number): Pick<BrowseHit, 'tags' | 'instances'> {
    const instances = db
      .select({
        sourceKey: s.sources.key,
        uri: s.documentInstances.uri,
        filePath: s.documentInstances.filePath,
      })
      .from(s.documentInstances)
      .innerJoin(s.sources, eq(s.documentInstances.sourceId, s.sources.id))
      .where(eq(s.documentInstances.documentId, documentId))
      .all()
    const tagRows = db
      .select({ name: s.tags.name })
      .from(s.tags)
      .innerJoin(s.documentTags, eq(s.documentTags.tagId, s.tags.id))
      .where(eq(s.documentTags.documentId, documentId))
      .all()
    return { tags: tagRows.map((t) => t.name), instances }
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
    return { kinds, sources, tags }
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
      .select({ id: s.collections.id, name: s.collections.name, parentId: s.collections.parentId })
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

  return { search, browse, nav, sourceSummaries, indexStats }
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
