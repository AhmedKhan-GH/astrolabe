# ACP Dialogue v1 — Design Spec

**Date:** 2026-07-11 · **Status:** approved direction; implement AFTER the Eagle↔Zotero sync
gestures (write plumbing proves out on deterministic code first)
**Roadmap home:** docs/2026-07-10-intelligence-layer-roadmap.md Layer 4 (pulled forward of
Layers 1–2 deliberately: it needs only the Layer-3 seed that already exists — the MCP server)

## Goal

Sign into your existing Claude (Pro/Max) or Codex (ChatGPT) account once, open a dialogue
pane inside Astrolabe, and converse with an agent that already knows your library — the
index MCP server mounted into every session, answers carrying provenance you can click.
Skills (`/graphify` etc.) work because the real Claude agent runs against the real
`~/.claude`. Astrolabe stores no keys, meters no tokens, resells nothing (amends D5:
subscriber accounts are the day-to-day path; BYOK remains for future batch work).

## Decision: ACP client now; Alioth later as an ACP AGENT

ACP is two-sided. Astrolabe implements the CLIENT side (the Zed role) via the official
TypeScript SDK (`@zed-industries/agent-client-protocol`). When Alioth earns its existence
(post graph layers — it is only justified by a bespoke graph context assembler), it is built
as a custom ACP agent (Agent SDK implements the agent side) and becomes a third row in the
agent picker. Same socket, same pane, same permissions — nothing built here is throwaway.

## Architecture

### Main process — `src/main/acp/`
- **`adapters.ts`** — the agent registry as DATA: `{key, label, command, args, env}` per
  adapter. v1 ships two: `claude` (claude-agent-acp, bundled as a dependency, spawned via
  Electron's node — ELECTRON_RUN_AS_NODE — pointing at the package bin) and `codex` (the
  Codex ACP adapter; resolved from PATH/config). An adapter appears in the picker only if
  its binary resolves (availability probe, mirrors connector checkAvailable).
- **`manager.ts`** — one AcpConnection per live session: spawn subprocess, `initialize`
  (client capabilities: NO fs, NO terminal in v1 — the library speaks only through MCP),
  `session/new` with the INDEX MCP SERVER in `mcpServers` (command = process.execPath,
  ELECTRON_RUN_AS_NODE, args = the bundled server entry + workspace db path), `session/prompt`,
  cancel, teardown on window close. Streamed `session/update` notifications forwarded to the
  renderer verbatim-but-typed. `session/request_permission` → forwarded to renderer → user
  choice returned; default-deny on timeout/close.
- **Auth:** v1 reuses CLI logins. If `initialize` reports auth required → the pane shows
  "run `claude` (or `codex login`) in a terminal, then retry" — no in-app OAuth yet.
- **MCP server packaging:** the stdio server (src/mcp/) gains a build target emitted into
  out/ (electron-vite node target or esbuild step) so the packaged app can spawn it without
  tsx. THIS IS THE ONE BUILD-WIRING RISK — same genre as the pdf.js asset packs.

### Wire (db-ipc.ts + preload; ONE new top-level key `acp` — e2e allowlist +1, update smoke)
- `acp:agents` → `{key, label, available, authenticated}[]`
- `acp:session-new {agentKey}` → `{sessionId}` | `{error}`
- `acp:prompt {sessionId, text}` → ack (updates stream separately)
- `acp:cancel {sessionId}`, `acp:permission-response {requestId, allow}`
- Events (webContents.send, subscribed via preload callback): `acp:update` (message chunks,
  tool-call begin/end, turn end), `acp:permission-request`.

### Renderer — `src/renderer/src/dialogue/`
- **`DialoguePane.tsx`** — a LEFT-OF-PANELS column toggled by a header button (coexists with
  the lens; independent of the Canvas/Note/Hub slot): agent picker, transcript, prompt box
  (Enter sends, Shift+Enter newline), stop button while streaming.
- **Transcript rendering:** react-markdown (existing dep) for agent text; tool calls as
  collapsed chips (name + status); provenance-aware links — `zotero://`/`eagle://`/
  `obsidian://` hrefs via system.openUri, and when a tool result carries a documentId the
  chip links to the Document Hub (openHub — the graph starts paying rent immediately).
- **Permission prompts:** inline card in the transcript (allow once / deny), default deny.
- **State:** one active session per pane in v1 (no tabs); switching agents starts a new session.

### Persistence — dialogues as first-party artifacts (docs/00)
`.astrolabe/dialogues/<ISO-stamp>-<slug>.json`: `{agentKey, startedAt, messages:[{role,
text, at}], toolCalls:[{name, at}], documentIds:[…]}` — documentIds harvested from tool
results for future graph linking (Layer 4→5 seam). Append-on-turn-end via a small main-side
writer (workspace lib pattern). Browsing past dialogues in-app is v1.1 — files are readable
markdown-adjacent JSON meanwhile.

## Testing (TDD; stakes × logic)

- **Unit (main):** adapters availability probe; manager protocol handling against a MOCK
  transport (scripted agent: initialize/new/prompt/update/permission sequences; assert
  client-capability minimalism, MCP mount payload, default-deny, teardown).
- **Unit (renderer):** transcript reducer (chunk assembly, tool-call lifecycle, turn ends);
  provenance link routing (scheme → openUri vs documentId → openHub); permission card flow.
- **Integration:** dialogue persistence round-trip (writer + file shape); MCP server bundle
  smoke — spawn the BUILT server via ELECTRON_RUN_AS_NODE and drive one search_library call
  over stdio (this pins the packaging risk).
- **E2E:** allowlist gains `acp`; boot stays clean with no adapter installed (pane shows
  "no agents available" — degrade like a missing connector, never a crash).
- **Live (manual gate):** `ASTROLABE_LIVE_ACP=1` — real claude-agent-acp session answering
  one library question end-to-end; the canary for adapter upgrades.

## Out of scope v1 (recorded)

- Write tools / write permissions (Layer-3 gates arrive with the graph-era MCP expansion).
- In-app OAuth; session tabs; dialogue browser UI; token/cost display.
- Alioth (custom agent) — post graph layers, enters as an ACP agent.
- fs/terminal client capabilities for agents — the library speaks only through MCP in v1.
