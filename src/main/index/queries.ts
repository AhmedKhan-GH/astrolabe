import { eq, sql, type SQL } from 'drizzle-orm'
import { z } from 'zod'
import type { Db } from '../db'
import * as s from '../db/schema'
import type { LibrariesSnapshot } from '../../shared/db-ipc'
import { folderIdsForSlugs } from './folder-mirror'

/**
 * Read path over the index, v2 (spine spec v2; skeleton surface). Named-channel
 * territory: FTS + joins deliberately bypass the generic table-client. Reused
 * verbatim by the MCP server when it returns (M5) — this module remains the
 * first draft of Alioth's context assembler.
 *
 * v2 vs v1: filters know the LIBRARY dimension (connectorKeys + libraryIds);
 * every default read hides ghosts behind the anchored predicate, and ONE
 * toggle (`includeGhosts`, D3) reveals them. Deferred with their milestones:
 * nav trees, presence facet (M1), folder prefixes (M2), virtual collections,
 * page annotations, document hub (M6).
 */

/** The selection dimensions. Dimensions AND together; within a dimension
 *  selection is a union (OR), with tags carrying ALL/ANY/NONE structure. All
 *  fields optional — the empty set is no constraint. */
export const filterSetSchema = z.object({
  connectorKeys: z.array(z.enum(['zotero', 'eagle', 'obsidian'])).max(3).optional(),
  libraryIds: z.array(z.number().int().positive()).max(100).optional(),
  collectionIds: z.array(z.number().int().positive()).max(100).optional(),
  kinds: z.array(z.enum(['pdf', 'image', 'note', 'other'])).max(4).optional(),
  tagsAll: z.array(z.string().max(200)).max(50).optional(),
  tagsAny: z.array(z.string().max(200)).max(50).optional(),
  tagsNone: z.array(z.string().max(200)).max(50).optional(),
  /** D3 — the single ghost toggle. Default surfaces show only documents with
   *  at least one instance; true reveals the retained-but-unanchored. */
  includeGhosts: z.boolean().default(false),
  /** Folder scope (folders spec §6): union dimension over the mirror. */
  folderSlugs: z.array(z.string().max(200)).max(50).optional(),
  includeSubfolders: z.boolean().default(false),
  /** The filing inbox: documents in NO folder. */
  uncategorized: z.boolean().default(false),
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

/** Per-instance provenance carried on every hit: which connector, which
 *  library (id + display name + availability), and how to open it. */
export interface HitInstance {
  instanceId: number
  connectorKey: string
  libraryId: number
  libraryName: string
  libraryAvailability: string
  uri: string
  filePath: string | null
  openPdfUri: string | null
}

export interface BrowseHit {
  documentId: number
  title: string
  kind: string
  modifiedAt: number
  tags: string[]
  instances: HitInstance[]
}
export interface BrowsePage {
  total: number
  hits: BrowseHit[]
}

export interface SearchHit {
  documentId: number
  title: string
  kind: string
  snippet: string
  tags: string[]
  instances: HitInstance[]
}

/** A node in the folder rail's tree (folders spec §6): the folder's own count
 *  and the distinct-document count across its whole subtree. */
export interface FolderTreeNode {
  slug: string
  name: string
  ownCount: number
  subtreeCount: number
  children: FolderTreeNode[]
}

export interface IndexStats {
  documents: number
  annotations: number
  /** Documents with zero instances (spec §2) — the toggle's badge count. */
  ghosts: number
}

/** A drizzle IN-list body: `?, ?, …` bound one placeholder per value (goes inside `IN (...)`). */
const inList = (values: (string | number)[]): SQL =>
  sql.join(
    values.map((v) => sql`${v}`),
    sql`, `,
  )

/** "At least one instance exists for the aliased `documents d`" — the anchored
 *  predicate whose absence defines a ghost. */
const anchored = sql`EXISTS (SELECT 1 FROM document_instances di WHERE di.document_id = d.id)`

/** Page-targetable open-pdf URI from an instance's metaJson, or null. The
 *  connector owns URI construction (it knows personal vs group library) and
 *  stores the ready base under `openPdfUri`; the read path never builds one. */
function openPdfUriFromMeta(metaJson: string | null): string | null {
  if (!metaJson) return null
  try {
    const parsed = JSON.parse(metaJson) as { openPdfUri?: unknown }
    return typeof parsed.openPdfUri === 'string' && parsed.openPdfUri ? parsed.openPdfUri : null
  } catch {
    return null
  }
}

export function createIndexQueries(db: Db) {
  /**
   * The FilterSet as SQL predicates over an aliased `documents d`, one row per
   * document via EXISTS (never JOIN+DISTINCT). Dimensions AND together; the
   * returned array is AND-joined by the caller.
   */
  function filterConditions(f: FilterSet): SQL[] {
    const conds: SQL[] = []

    if (!f.includeGhosts) conds.push(anchored)

    if (f.folderSlugs?.length) {
      const ids = folderIdsForSlugs(db, f.folderSlugs, f.includeSubfolders)
      // An empty id set must match NOTHING (a filter for a deleted folder is
      // not "no filter").
      conds.push(
        ids.length
          ? sql`EXISTS (SELECT 1 FROM folder_members fm
                        WHERE fm.document_id = d.id AND fm.folder_id IN (${inList(ids)}))`
          : sql`0`,
      )
    }
    if (f.uncategorized)
      conds.push(sql`NOT EXISTS (SELECT 1 FROM folder_members fm WHERE fm.document_id = d.id)`)

    // Scope union: any selected connector, any selected library, any selected collection.
    const scope: SQL[] = []
    if (f.connectorKeys?.length)
      scope.push(
        sql`EXISTS (SELECT 1 FROM document_instances di
                    JOIN libraries l ON di.library_id = l.id
                    JOIN connectors c ON l.connector_id = c.id
                    WHERE di.document_id = d.id AND c.key IN (${inList(f.connectorKeys)}))`,
      )
    if (f.libraryIds?.length)
      scope.push(
        sql`EXISTS (SELECT 1 FROM document_instances di
                    WHERE di.document_id = d.id AND di.library_id IN (${inList(f.libraryIds)}))`,
      )
    if (f.collectionIds?.length)
      scope.push(
        sql`EXISTS (SELECT 1 FROM document_collections dc
                    WHERE dc.document_id = d.id AND dc.collection_id IN (${inList(f.collectionIds)}))`,
      )
    if (scope.length) conds.push(sql`(${sql.join(scope, sql` OR `)})`)

    if (f.kinds?.length) conds.push(sql`d.kind IN (${inList(f.kinds)})`)

    // tagsAll: every named tag — one EXISTS per tag, AND-joined.
    for (const tag of f.tagsAll ?? [])
      conds.push(
        sql`EXISTS (SELECT 1 FROM document_tags dt JOIN tags t ON dt.tag_id = t.id
                    WHERE dt.document_id = d.id AND t.name = ${tag})`,
      )

    if (f.tagsAny?.length)
      conds.push(
        sql`EXISTS (SELECT 1 FROM document_tags dt JOIN tags t ON dt.tag_id = t.id
                    WHERE dt.document_id = d.id AND t.name IN (${inList(f.tagsAny)}))`,
      )

    if (f.tagsNone?.length)
      conds.push(
        sql`NOT EXISTS (SELECT 1 FROM document_tags dt JOIN tags t ON dt.tag_id = t.id
                        WHERE dt.document_id = d.id AND t.name IN (${inList(f.tagsNone)}))`,
      )

    return conds
  }

  /** A document's tags + per-library provenance — the shared tail of a hit. */
  function hydrate(documentId: number): Pick<BrowseHit, 'tags' | 'instances'> {
    const instanceRows = db
      .select({
        instanceId: s.documentInstances.id,
        connectorKey: s.connectors.key,
        libraryId: s.libraries.id,
        libraryName: s.libraries.displayName,
        libraryAvailability: s.libraries.availability,
        uri: s.documentInstances.uri,
        filePath: s.documentInstances.filePath,
        metaJson: s.documentInstances.metaJson,
      })
      .from(s.documentInstances)
      .innerJoin(s.libraries, eq(s.documentInstances.libraryId, s.libraries.id))
      .innerJoin(s.connectors, eq(s.libraries.connectorId, s.connectors.id))
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
    return { tags: tagRows.map((t) => t.name), instances }
  }

  function search(raw: unknown): SearchHit[] {
    const req = searchRequestSchema.parse(raw)
    // FTS5 MATCH first (bm25 ranking; snippet from body else title), THEN
    // narrow via the same predicates as browse — the FTS table stays unaliased
    // so bm25()/snippet() bind to it, and `documents d` rides along.
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
      return [
        { documentId: doc.id, title: doc.title, kind: doc.kind, snippet: r.snippet, ...hydrate(doc.id) },
      ]
    })
  }

  /**
   * The recency river: the filtered, newest-first document page plus the total
   * filtered count (drives the virtualizer size). Offset paging — at 10³–10⁴
   * docs SQLite offset cost is irrelevant and keyset is YAGNI.
   */
  function browse(raw: unknown): BrowsePage {
    const req = browseRequestSchema.parse(raw)
    const conds = filterConditions(req)
    const where = conds.length ? sql`WHERE ${sql.join(conds, sql` AND `)}` : sql``
    const total = db.get<{ c: number }>(sql`SELECT count(*) AS c FROM documents d ${where}`)?.c ?? 0
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

  /** The `index:libraries` payload (shared contract): connector statuses plus
   *  every library with availability and its distinct-document count. */
  function librariesSnapshot(): LibrariesSnapshot {
    const connectors = db
      .select()
      .from(s.connectors)
      .all()
      .map((c) => ({ key: c.key as LibrariesSnapshot['connectors'][number]['key'], status: c.status }))
    const libraries = db
      .select({
        id: s.libraries.id,
        connector: s.connectors.key,
        stableKey: s.libraries.stableKey,
        displayName: s.libraries.displayName,
        availability: s.libraries.availability,
        lastSeenAt: s.libraries.lastSeenAt,
        lastScanAt: s.libraries.lastScanAt,
      })
      .from(s.libraries)
      .innerJoin(s.connectors, eq(s.libraries.connectorId, s.connectors.id))
      .orderBy(s.connectors.key, s.libraries.displayName)
      .all()
      .map((l) => ({
        ...(l as Omit<LibrariesSnapshot['libraries'][number], 'documentCount'>),
        documentCount:
          db
            .select({ c: sql<number>`count(distinct ${s.documentInstances.documentId})` })
            .from(s.documentInstances)
            .where(eq(s.documentInstances.libraryId, l.id))
            .get()?.c ?? 0,
      }))
    return { connectors, libraries }
  }

  /** Index-wide totals for the always-on stats strip. `documents` counts every
   *  row (the table already merges duplicates); `ghosts` counts the unanchored
   *  subset — the badge beside the D3 toggle. */
  function indexStats(): IndexStats {
    const documents = db.select({ c: sql<number>`count(*)` }).from(s.documents).get()?.c ?? 0
    const annotations = db.select({ c: sql<number>`count(*)` }).from(s.annotations).get()?.c ?? 0
    const ghosts =
      db.get<{ c: number }>(
        sql`SELECT count(*) AS c FROM documents d WHERE NOT ${anchored}`,
      )?.c ?? 0
    return { documents, annotations, ghosts }
  }

  /** The rail payload (spec §6): the folder tree with own + distinct-subtree
   *  counts. Small data (10² folders); computed in JS from two full reads. */
  function folderTree(): FolderTreeNode[] {
    const rows = db.select().from(s.folders).all()
    const members = db.select().from(s.folderMembers).all()
    const docsByFolder = new Map<number, Set<number>>()
    for (const m of members) {
      const set = docsByFolder.get(m.folderId) ?? new Set<number>()
      set.add(m.documentId)
      docsByFolder.set(m.folderId, set)
    }
    const childrenOf = new Map<number | null, typeof rows>()
    for (const r of rows) {
      const list = childrenOf.get(r.parentId) ?? []
      list.push(r)
      childrenOf.set(r.parentId, list)
    }
    const build = (row: (typeof rows)[number]): { node: FolderTreeNode; docs: Set<number> } => {
      const own = docsByFolder.get(row.id) ?? new Set<number>()
      const kids = (childrenOf.get(row.id) ?? []).sort((a, b) => a.name.localeCompare(b.name)).map(build)
      const subtree = new Set(own)
      for (const k of kids) for (const d of k.docs) subtree.add(d)
      return {
        node: {
          slug: row.slug,
          name: row.name,
          ownCount: own.size,
          subtreeCount: subtree.size,
          children: kids.map((k) => k.node),
        },
        docs: subtree,
      }
    }
    return (childrenOf.get(null) ?? []).sort((a, b) => a.name.localeCompare(b.name)).map((r) => build(r).node)
  }

  /** The inbox badge (spec §6): anchored documents in no folder. */
  function uncategorizedCount(): number {
    return (
      db.get<{ c: number }>(
        sql`SELECT count(*) AS c FROM documents d
            WHERE ${anchored} AND NOT EXISTS
              (SELECT 1 FROM folder_members fm WHERE fm.document_id = d.id)`,
      )?.c ?? 0
    )
  }

  return { search, browse, librariesSnapshot, indexStats, folderTree, uncategorizedCount }
}

export type IndexQueries = ReturnType<typeof createIndexQueries>
