import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { ensureWorkspace } from '../main/lib/workspace'
import { openReadonlyDb, type Db } from './db'
import {
  createHandlers,
  getAnnotationsInput,
  getDocumentInput,
  searchLibraryInput,
} from './handlers'

/**
 * The stdio MCP server (runway step 7). CRITICAL: stdout is the JSON-RPC wire —
 * nothing else may write to it (no logger, no console.log). Diagnostics go to
 * stderr only. Tool results are JSON stringified into a single text content block.
 */

function jsonResult(payload: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] }
}

/** Build the server around an already-open (read-only) index. Separated from I/O so
 *  the integration tier can register the same tools against a temp db. */
export function createServer(db: Db): McpServer {
  const handlers = createHandlers(db)
  const server = new McpServer({ name: 'astrolabe', version: '0.1.0' })

  server.registerTool(
    'search_library',
    {
      description:
        'Full-text search across the whole unified library (Zotero papers, Eagle images, notes) ' +
        'including annotation text. Use this FIRST to find documents by topic/keyword. Returns ' +
        'ranked hits with title, kind, snippet, tags, and per-source provenance {sourceKey, uri, filePath}.',
      inputSchema: searchLibraryInput,
    },
    (args) => jsonResult(handlers.searchLibrary(args)),
  )

  server.registerTool(
    'get_document',
    {
      description:
        'Fetch one document by its numeric documentId (from a search_library hit): full metadata, ' +
        'every source instance (with provenance URIs), tags, and collection/folder names. Use when ' +
        'you need the complete record for a specific document.',
      inputSchema: getDocumentInput,
    },
    (args) => jsonResult(handlers.getDocument(args)),
  )

  server.registerTool(
    'get_annotations',
    {
      description:
        "Get all highlights and notes the user made on a document (across all its source instances), " +
        'by documentId. Each returns text, comment, pageLabel, color, and an openPdfUri that opens the ' +
        'PDF at that page in Zotero when available. Use to answer "what did I highlight/note about X?".',
      inputSchema: getAnnotationsInput,
    },
    (args) => jsonResult(handlers.getAnnotations(args)),
  )

  server.registerTool(
    'list_sources',
    {
      description:
        'List the connected sources (zotero, eagle, …) with sync status, last sync time, and how many ' +
        'documents each contributes. Use to understand library coverage or check whether a source synced.',
    },
    () => jsonResult(handlers.listSources()),
  )

  return server
}

/** Open the real workspace index read-only and serve over stdio. */
export async function serve(): Promise<void> {
  const { dbPath } = ensureWorkspace()
  const { db } = openReadonlyDb(dbPath)
  const server = createServer(db)
  const transport = new StdioServerTransport()
  await server.connect(transport)
  // eslint-disable-next-line no-console -- stderr is allowed; stdout is the protocol.
  console.error(`[astrolabe-mcp] serving read-only index at ${dbPath}`)
}
