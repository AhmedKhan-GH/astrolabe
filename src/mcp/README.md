# Astrolabe MCP Server (interim agentic access — runway step 7 / Phase 1.5)

A stdio MCP server exposing the **read-only** Astrolabe index to any MCP client (Claude Code,
Claude Desktop, …). This is the interim agentic layer: grounded Q&A over your whole library with
zero discovery-token burn, months before Alioth. Its handlers are the first draft of Alioth's
context assembler (Phase 3 consumes them).

## Prerequisite

The index must exist and be populated: run the app and hit **Sync now**, or `pnpm sync:live`.
The server opens `~/Astrolabe/.astrolabe/index.db` with `readonly + fileMustExist` — it never
writes, never migrates, and fails fast if the index is absent. WAL makes concurrent reads safe
while the app runs.

## Register in Claude Code

```bash
claude mcp add astrolabe -- pnpm --dir /Users/ahmed/WebstormProjects/astrolabe mcp:serve
```

## Register in Claude Desktop

`~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "astrolabe": {
      "command": "pnpm",
      "args": ["--dir", "/Users/ahmed/WebstormProjects/astrolabe", "mcp:serve"]
    }
  }
}
```

## Tools

All tools are **read-only** and **path-free**: file paths are stripped from every output (agents
have no filesystem access by design). `documentId` in each per-document tool comes from a
`search_library` or `browse_library` hit.

| Tool | Use |
|---|---|
| `list_overview()` | call ONCE first: kinds, sources (counts+status), top ~50 tags, virtual collections, presence buckets — the library's shape and the valid filter values |
| `search_library({q, limit?, ...filters})` | FTS over titles/annotations/tags → ranked hits `{documentId, title, kind, snippet, tags, instances, virtualCollections}`; accepts the same filters as browse |
| `browse_library({...filters, offset?, limit?})` | recency river (newest-first) with NO query; the library filter set (sourceKeys, kinds, tags*, collectionIds, folderPrefixes, virtualCollections, presence); `limit` capped at 50 → `{total, hits:[{documentId, title, kind, modifiedAt, tags, sources}]}` |
| `get_document({documentId})` | full record: tags, instances (URIs, `openPdfUri`), virtual collections, annotation summary, presence, backlinks (errors if not found) |
| `get_annotations({documentId})` | highlights/notes with pageLabel + `openPdfUri` (opens Zotero at the page) |
| `get_page_annotations({documentId})` | per-page annotation counts `{pages:[{pageIndex, count}]}` — the canvas heat data |
| `get_links({documentId})` | the wiki-link graph: `{outlinks, backlinks}` with titles/kinds |
| `list_sources()` | per-source sync status + document counts |

## Implementation notes

- **stdout is the JSON-RPC wire** — nothing else may write to it. Diagnostics go to stderr
  (`console.error`/`warn` only; enforced by this directory's nested eslint config).
- `server.ts` re-execs itself under Electron-as-node when launched by plain node/tsx:
  better-sqlite3 here is compiled for Electron's ABI (`install-app-deps`), so the plain-node
  binary can't load it. The child inherits stdio, so the wire protocol is unaffected.
- Handlers are transport-free (`handlers.ts`) and covered by the integration tier
  (`server.itest.ts`) against a real temp SQLite index.
