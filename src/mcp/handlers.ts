import { eq } from 'drizzle-orm'
import { z } from 'zod'
import * as s from '../main/db/schema'
import { createIndexQueries, type SearchHit, type SourceSummary } from '../main/index/queries'
import type { Db } from './db'

export type { SourceSummary }

/**
 * The MCP tool logic (runway step 7). Pure functions over the read-only index —
 * no MCP/transport types here so the integration tier can exercise them directly.
 * search reuses the Step-3 query module verbatim; the rest are thin read joins.
 * Every handler validates its input with zod at the boundary (defence in depth:
 * the SDK also validates, but direct callers/tests do not).
 */

export const getDocumentInput = { documentId: z.number().int().positive() }
export const getAnnotationsInput = { documentId: z.number().int().positive() }
export const searchLibraryInput = {
  q: z.string().min(1).max(500),
  limit: z.number().int().positive().max(200).optional(),
}

const documentIdSchema = z.object({ documentId: z.number().int().positive() })

/** Zotero stashes the openable PDF target in the annotation's positionJson. */
const positionSchema = z
  .object({ openPdfUri: z.string(), attachmentKey: z.string() })
  .partial()

export interface DocumentDetail {
  document: s.Document
  instances: { sourceKey: string; uri: string; filePath: string | null }[]
  tags: string[]
  collections: string[]
}

export interface AnnotationDetail {
  type: string
  text: string | null
  comment: string | null
  pageLabel: string | null
  color: string | null
  openPdfUri: string | null
  sourceKey: string
  uri: string
}

function openPdfUriOf(positionJson: string | null): string | null {
  if (positionJson == null) return null
  try {
    const parsed = positionSchema.safeParse(JSON.parse(positionJson))
    return parsed.success ? (parsed.data.openPdfUri ?? null) : null
  } catch {
    return null
  }
}

export function createHandlers(db: Db) {
  const queries = createIndexQueries(db)

  function searchLibrary(raw: unknown): SearchHit[] {
    // queries.search parses {q, limit} itself (searchRequestSchema).
    return queries.search(raw)
  }

  function getDocument(raw: unknown): DocumentDetail | null {
    const { documentId } = documentIdSchema.parse(raw)
    const document = db.select().from(s.documents).where(eq(s.documents.id, documentId)).get()
    if (!document) return null
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
    const tags = db
      .select({ name: s.tags.name })
      .from(s.tags)
      .innerJoin(s.documentTags, eq(s.documentTags.tagId, s.tags.id))
      .where(eq(s.documentTags.documentId, documentId))
      .all()
      .map((t) => t.name)
    const collections = db
      .select({ name: s.collections.name })
      .from(s.collections)
      .innerJoin(s.documentCollections, eq(s.documentCollections.collectionId, s.collections.id))
      .where(eq(s.documentCollections.documentId, documentId))
      .all()
      .map((c) => c.name)
    return { document, instances, tags, collections }
  }

  function getAnnotations(raw: unknown): AnnotationDetail[] {
    const { documentId } = documentIdSchema.parse(raw)
    const rows = db
      .select({
        type: s.annotations.type,
        text: s.annotations.text,
        comment: s.annotations.comment,
        pageLabel: s.annotations.pageLabel,
        color: s.annotations.color,
        positionJson: s.annotations.positionJson,
        sourceKey: s.sources.key,
        uri: s.documentInstances.uri,
      })
      .from(s.annotations)
      .innerJoin(s.documentInstances, eq(s.annotations.instanceId, s.documentInstances.id))
      .innerJoin(s.sources, eq(s.documentInstances.sourceId, s.sources.id))
      .where(eq(s.documentInstances.documentId, documentId))
      .all()
    return rows.map((r) => ({
      type: r.type,
      text: r.text,
      comment: r.comment,
      pageLabel: r.pageLabel,
      color: r.color,
      openPdfUri: openPdfUriOf(r.positionJson),
      sourceKey: r.sourceKey,
      uri: r.uri,
    }))
  }

  function listSources(): SourceSummary[] {
    // Shared with the lens status strip (src/main/index/queries.ts).
    return queries.sourceSummaries()
  }

  return { searchLibrary, getDocument, getAnnotations, listSources }
}

export type Handlers = ReturnType<typeof createHandlers>
