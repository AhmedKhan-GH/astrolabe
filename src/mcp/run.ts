import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { ensureWorkspace } from '../main/lib/workspace'
import { openReadonlyDb, type Db } from './db'
import {
  createHandlers,
  getAnnotationsInput,
  getDocumentInput,
  getLinksInput,
  getPageAnnotationsInput,
  browseLibraryInput,
  searchLibraryInput,
  NotFoundError,
} from './handlers'

/**
 * The stdio MCP server (runway step 7 / roadmap M2 read half). CRITICAL: stdout is the
 * JSON-RPC wire — nothing else may write to it (no logger, no console.log). Diagnostics go
 * to stderr only. Tool results are JSON stringified into a single text content block. Every
 * tool is READ-ONLY (the db is opened readonly); there are deliberately no write tools.
 */

function jsonResult(payload: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] }
}

/** A clean MCP error result (e.g. an unknown documentId), distinct from a thrown exception. */
function errorResult(message: string): CallToolResult {
  return { content: [{ type: 'text', text: message }], isError: true }
}

/** Build the server around an already-open (read-only) index. Separated from I/O so
 *  the integration tier can register the same tools against a temp db. */
export function createServer(db: Db): McpServer {
  const handlers = createHandlers(db)
  const server = new McpServer({ name: 'astrolabe', version: '0.1.0' })

  server.registerTool(
    'list_overview',
    {
      description:
        'Call this ONCE to learn the shape of the library before searching or browsing. Returns the ' +
        'index-wide facets: kinds with counts (pdf/image/note/other), connected sources with document ' +
        'counts and sync status, the top ~50 tags by document count, virtual collections (slug+name+count), ' +
        'and the presence buckets (both / zotero-only / eagle-only — the Zotero↔Eagle overlap). Use the ' +
        'kinds, tags, sources, virtualCollections and presence values you see here as valid filter inputs ' +
        'to browse_library and search_library.',
    },
    () => jsonResult(handlers.listOverview()),
  )

  server.registerTool(
    'search_library',
    {
      description:
        'Full-text search across the whole unified library (Zotero papers, Eagle images, Obsidian/GoodNotes ' +
        'notes) including annotation text. Use this to find documents by topic/keyword. The same library ' +
        'filters as browse_library (sourceKeys, kinds, tags*, collectionIds, virtualCollections, presence) ' +
        'can be passed to narrow the query. Returns ranked hits: {documentId, title, kind, snippet, tags, ' +
        'instances[{instanceId, sourceKey, uri, openPdfUri}], virtualCollections}. Pass a documentId to ' +
        'get_document for the full record. To LIST recent documents without a query, use browse_library ' +
        'instead; to learn what tags/kinds/sources exist first, call list_overview.',
      inputSchema: searchLibraryInput,
    },
    (args) => jsonResult(handlers.searchLibrary(args)),
  )

  server.registerTool(
    'browse_library',
    {
      description:
        'Browse the library as a recency river (newest-first) WITHOUT a search query — the tool for ' +
        '"what did I add recently?" or "list everything tagged X in Zotero". Accepts the full library ' +
        'filter set (all optional, AND-combined across dimensions): sourceKeys (zotero|eagle|obsidian|' +
        'goodnotes), kinds (pdf|image|note|other), tagsAll/tagsAny/tagsNone, collectionIds, folderPrefixes, ' +
        'virtualCollections, presence (both|zotero-only|eagle-only), plus offset and limit (max 50). ' +
        'Returns {total, hits:[{documentId, title, kind, modifiedAt, tags, sources}]} — a COMPACT row; jump ' +
        'to get_document with a documentId for full instances/annotations/links. Call list_overview first ' +
        'to discover valid tag/source/collection values.',
      inputSchema: browseLibraryInput,
    },
    (args) => jsonResult(handlers.browseLibrary(args)),
  )

  server.registerTool(
    'get_document',
    {
      description:
        'Fetch the full record for one document by its numeric documentId (obtained from a search_library ' +
        'or browse_library hit). Returns {documentId, title, kind, modifiedAt, tags, instances[{instanceId, ' +
        'sourceKey, uri, openPdfUri}], virtualCollections[{slug, name}], annotations{total, pages}, presence ' +
        '(both|zotero-only|eagle-only|none), backlinks}. Use when you need the complete metadata for a ' +
        'specific document; use get_annotations for the highlight/note text and get_links for the wiki-link ' +
        'graph. Errors if the documentId does not exist.',
      inputSchema: getDocumentInput,
    },
    (args) => {
      try {
        return jsonResult(handlers.getDocument(args))
      } catch (err) {
        if (err instanceof NotFoundError) return errorResult(err.message)
        throw err
      }
    },
  )

  server.registerTool(
    'get_annotations',
    {
      description:
        'Get all highlights and notes the user made on a document (across all its source instances), by ' +
        'documentId (from a search_library or browse_library hit). Each returns {type, text, comment, ' +
        'pageLabel, color, openPdfUri (opens the PDF at that page in Zotero when available), sourceKey, uri}. ' +
        'Use to answer "what did I highlight/note about X?". For per-page annotation COUNTS (which pages are ' +
        'heavily marked up) use get_page_annotations instead.',
      inputSchema: getAnnotationsInput,
    },
    (args) => jsonResult(handlers.getAnnotations(args)),
  )

  server.registerTool(
    'get_page_annotations',
    {
      description:
        'Per-page annotation counts for one PDF document, by documentId (from a search_library or ' +
        'browse_library hit) — the canvas "heat" data. Returns {pages:[{pageIndex, count}]}, ordered by ' +
        'pageIndex, counting page-anchored annotations across all of the document\'s source instances. Use ' +
        'to answer "which pages are the most heavily annotated?" or to find the densest sections. For the ' +
        'annotation TEXT itself use get_annotations.',
      inputSchema: getPageAnnotationsInput,
    },
    (args) => jsonResult(handlers.getPageAnnotations(args)),
  )

  server.registerTool(
    'get_links',
    {
      description:
        'The wiki-link graph for one document (Obsidian [[wiki-links]]), by documentId (from a search_library ' +
        'or browse_library hit). Returns {outlinks:[{targetName, documentId, title, kind, instanceId}], ' +
        'backlinks:[{documentId, title, kind, instanceId}]}: outlinks are the notes this document links TO ' +
        '(documentId/title null when a link is unresolved or ambiguous), backlinks are the notes that link ' +
        'TO this document. Use to traverse the note graph — "what references this?" or "what does this note ' +
        'cite?".',
      inputSchema: getLinksInput,
    },
    (args) => jsonResult(handlers.getLinks(args)),
  )

  server.registerTool(
    'list_sources',
    {
      description:
        'List the connected sources (zotero, eagle, obsidian, goodnotes) with sync status, last sync time, ' +
        'and how many documents each contributes. Use to understand library coverage or check whether a ' +
        'source synced. For a fuller picture of the library (kinds, tags, virtual collections, presence) ' +
        'call list_overview instead.',
    },
    () => jsonResult(handlers.listSources()),
  )

  return server
}

/**
 * Resolve the index db path: an explicit argv path wins, otherwise fall back to
 * the workspace default (env-driven — ASTROLABE_WORKSPACE). The packaged app
 * spawns `server.mjs <dbPath>`, so argv[2] is the primary path; `pnpm mcp:serve`
 * passes nothing and gets the ensureWorkspace() default.
 */
export function resolveDbPath(argvPath: string | undefined, fallback: () => string): string {
  return argvPath != null && argvPath.length > 0 ? argvPath : fallback()
}

/** Open the index read-only (given path, else workspace default) and serve over stdio. */
export async function serve(dbPath?: string): Promise<void> {
  const resolved = dbPath ?? ensureWorkspace().dbPath
  const { db } = openReadonlyDb(resolved)
  const server = createServer(db)
  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error(`[astrolabe-mcp] serving read-only index at ${resolved}`)
}

/** True when this module is the process entry point (the built out/mcp/server.mjs),
 *  not merely imported (by server.ts's tsx path, or by tests). */
function isDirectRun(): boolean {
  const entry = process.argv[1]
  if (entry == null) return false
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
}

if (isDirectRun()) {
  // Packaged entry: db path from argv[2], workspace default otherwise.
  serve(resolveDbPath(process.argv[2], () => ensureWorkspace().dbPath)).catch((err) => {
    console.error('[astrolabe-mcp] fatal', err)
    process.exit(1)
  })
}
