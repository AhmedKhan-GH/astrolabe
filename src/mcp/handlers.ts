import { eq } from 'drizzle-orm'
import { z } from 'zod'
import * as s from '../main/db/schema'
import {
  createIndexQueries,
  filterSetSchema,
  type BrowsePage,
  type DocumentDetail,
  type NavData,
  type PageAnnotations,
  type SearchHit,
  type SourceSummary,
} from '../main/index/queries'
import { documentLinks, type DocumentLinks } from '../main/index/links'
import type { Db } from './db'

export type { SourceSummary, DocumentLinks, PageAnnotations }

/**
 * The MCP tool logic (runway step 7 / roadmap M2). Pure functions over the read-only
 * index — no MCP/transport types here so the integration tier can exercise them directly.
 * Everything is a thin adapter over the Step-3 query module (`createIndexQueries`) reused
 * verbatim; the handlers add only the AGENT-FACING projection: file paths are stripped from
 * every shape (agents have no filesystem access by design — a leaked absolute path is useless
 * and unsafe), browse is capped to 50 hits for token sanity, and the nav payload is trimmed.
 * Every handler validates its input with zod at the boundary (defence in depth: the SDK also
 * validates, but direct callers/tests do not).
 */

export const getDocumentInput = { documentId: z.number().int().positive() }
export const getAnnotationsInput = { documentId: z.number().int().positive() }
export const getLinksInput = { documentId: z.number().int().positive() }
export const getPageAnnotationsInput = { documentId: z.number().int().positive() }
export const searchLibraryInput = {
  q: z.string().min(1).max(500),
  limit: z.number().int().positive().max(200).optional(),
}
/** Browse mirrors the library filter set (see filterSetSchema) plus offset paging. `limit` is
 *  capped at 50 (not the query module's 200) so an agent never blows its context on one call. */
export const browseLibraryInput = {
  ...filterSetSchema.shape,
  offset: z.number().int().min(0).optional(),
  limit: z.number().int().positive().max(50).optional(),
}

const documentIdSchema = z.object({ documentId: z.number().int().positive() })
const browseSchema = z.object(browseLibraryInput)

/** Zotero stashes the openable PDF target in the annotation's positionJson. */
const positionSchema = z
  .object({ openPdfUri: z.string(), attachmentKey: z.string() })
  .partial()

/** A document instance as agents see it: provenance URIs only, never a filesystem path. */
export interface McpInstance {
  instanceId: number
  sourceKey: string
  uri: string
  openPdfUri: string | null
}

/** search_library / get_document hits with the filesystem path projected away. */
export type McpSearchHit = Omit<SearchHit, 'instances'> & { instances: McpInstance[] }
export type McpDocumentDetail = Omit<DocumentDetail, 'instances'> & { instances: McpInstance[] }

/** browse_library's compact row — sources only (agents jump to full instances via get_document). */
export interface BrowseCompactHit {
  documentId: number
  title: string
  kind: string
  modifiedAt: number
  tags: string[]
  sources: string[]
}
export interface BrowseResult {
  total: number
  hits: BrowseCompactHit[]
}

/** list_overview payload — the nav rail trimmed for agents (no browse trees, no paths). */
export interface Overview {
  kinds: NavData['kinds']
  sources: { key: string; status: string; documentCount: number }[]
  tags: NavData['tags']
  virtualCollections: NavData['virtualCollections']
  presence: NavData['presence']
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

/** Thrown when a documentId does not resolve — the server maps it to an MCP error result. */
export class NotFoundError extends Error {}

function openPdfUriOf(positionJson: string | null): string | null {
  if (positionJson == null) return null
  try {
    const parsed = positionSchema.safeParse(JSON.parse(positionJson))
    return parsed.success ? (parsed.data.openPdfUri ?? null) : null
  } catch {
    return null
  }
}

/** Drop `filePath` from every instance (agents never receive a path). */
function stripPaths(
  instances: (McpInstance & { filePath: string | null })[],
): McpInstance[] {
  return instances.map((inst) => {
    const { filePath, ...rest } = inst
    void filePath
    return rest
  })
}

export function createHandlers(db: Db) {
  const queries = createIndexQueries(db)

  function searchLibrary(raw: unknown): McpSearchHit[] {
    // queries.search parses {q, limit, ...filters} itself (searchRequestSchema).
    return queries.search(raw).map((hit) => ({ ...hit, instances: stripPaths(hit.instances) }))
  }

  function browseLibrary(raw: unknown): BrowseResult {
    const req = browseSchema.parse(raw)
    // Cap the page at 50 even when the caller omits limit (query module would default to 100).
    const page: BrowsePage = queries.browse({ ...req, limit: req.limit ?? 50 })
    return {
      total: page.total,
      hits: page.hits.map((h) => ({
        documentId: h.documentId,
        title: h.title,
        kind: h.kind,
        modifiedAt: h.modifiedAt,
        tags: h.tags,
        sources: [...new Set(h.instances.map((i) => i.sourceKey))],
      })),
    }
  }

  function getDocument(raw: unknown): McpDocumentDetail {
    const { documentId } = documentIdSchema.parse(raw)
    const detail = queries.documentDetail(documentId)
    if (!detail) throw new NotFoundError(`document ${documentId} not found`)
    return { ...detail, instances: stripPaths(detail.instances) }
  }

  function getLinks(raw: unknown): DocumentLinks {
    const { documentId } = documentIdSchema.parse(raw)
    return documentLinks(db, documentId)
  }

  function getPageAnnotations(raw: unknown): PageAnnotations {
    // queries.pageAnnotations parses {documentId} itself (pageAnnotationsRequestSchema).
    return queries.pageAnnotations(raw)
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

  function listOverview(): Overview {
    const nav = queries.nav()
    return {
      kinds: nav.kinds,
      // Drop the per-source browse tree (agents don't render a rail) — counts + status only.
      sources: nav.sources.map((src) => ({
        key: src.key,
        status: src.status,
        documentCount: src.documentCount,
      })),
      // Top ~50 tags by count (nav returns them count-desc already).
      tags: nav.tags.slice(0, 50),
      virtualCollections: nav.virtualCollections,
      presence: nav.presence,
    }
  }

  return {
    searchLibrary,
    browseLibrary,
    getDocument,
    getLinks,
    getPageAnnotations,
    getAnnotations,
    listSources,
    listOverview,
  }
}

export type Handlers = ReturnType<typeof createHandlers>
