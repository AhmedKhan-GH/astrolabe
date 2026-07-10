import { eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import type { Db } from '../db'
import * as s from '../db/schema'

/**
 * Read path over the index (runway step 3; grows in step 6, reused verbatim by the
 * step-7 MCP server — this module is the first draft of Alioth's context assembler).
 * Named-channel territory: FTS + joins deliberately bypass the generic table-client.
 */
export const searchRequestSchema = z.object({
  q: z.string().min(1).max(500),
  limit: z.number().int().positive().max(200).default(50),
})
export type SearchRequest = z.infer<typeof searchRequestSchema>

export interface SearchHit {
  documentId: number
  title: string
  kind: string
  snippet: string
  tags: string[]
  instances: { sourceKey: string; uri: string; filePath: string | null }[]
}

export function createIndexQueries(db: Db) {
  function search(raw: unknown): SearchHit[] {
    const req = searchRequestSchema.parse(raw)
    // FTS5 MATCH with bm25 ranking; snippet from body else title.
    const rows = db.all<{ rowid: number; snippet: string }>(
      sql`SELECT rowid, snippet(search_fts, 1, '⟪', '⟫', '…', 18) AS snippet
          FROM search_fts WHERE search_fts MATCH ${req.q}
          ORDER BY bm25(search_fts) LIMIT ${req.limit}`,
    )
    return rows.flatMap((r) => {
      const doc = db.select().from(s.documents).where(eq(s.documents.id, r.rowid)).get()
      if (!doc) return []
      const instances = db
        .select({
          sourceKey: s.sources.key,
          uri: s.documentInstances.uri,
          filePath: s.documentInstances.filePath,
        })
        .from(s.documentInstances)
        .innerJoin(s.sources, eq(s.documentInstances.sourceId, s.sources.id))
        .where(eq(s.documentInstances.documentId, doc.id))
        .all()
      const tagRows = db
        .select({ name: s.tags.name })
        .from(s.tags)
        .innerJoin(s.documentTags, eq(s.documentTags.tagId, s.tags.id))
        .where(eq(s.documentTags.documentId, doc.id))
        .all()
      return [
        {
          documentId: doc.id,
          title: doc.title,
          kind: doc.kind,
          snippet: r.snippet,
          tags: tagRows.map((t) => t.name),
          instances,
        },
      ]
    })
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

  return { search, sourceSummaries }
}

export interface SourceSummary {
  key: string
  status: string
  lastSyncAt: number | null
  documentCount: number
}

export type IndexQueries = ReturnType<typeof createIndexQueries>
