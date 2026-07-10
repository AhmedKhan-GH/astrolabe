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

| Tool | Use |
|---|---|
| `search_library({q, limit?})` | FTS over titles/annotations/tags → ranked hits with provenance |
| `get_document({documentId})` | full record: instances (URIs, paths), tags, collections |
| `get_annotations({documentId})` | highlights/notes with pageLabel + `openPdfUri` (opens Zotero at the page) |
| `list_sources()` | per-source sync status + document counts |

## Implementation notes

- **stdout is the JSON-RPC wire** — nothing else may write to it. Diagnostics go to stderr
  (`console.error`/`warn` only; enforced by this directory's nested eslint config).
- `server.ts` re-execs itself under Electron-as-node when launched by plain node/tsx:
  better-sqlite3 here is compiled for Electron's ABI (`install-app-deps`), so the plain-node
  binary can't load it. The child inherits stdio, so the wire protocol is unaffected.
- Handlers are transport-free (`handlers.ts`) and covered by the integration tier
  (`server.itest.ts`) against a real temp SQLite index.
