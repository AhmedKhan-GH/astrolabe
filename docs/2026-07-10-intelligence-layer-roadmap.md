# Intelligence Layer Roadmap — Graph, MCP, ACP, and the Learner Model

**Date:** 2026-07-10 · **Status:** approved direction (long-term; supersedes nothing — this
sequences the deferred intelligence scope of docs/06 Phases 2–3 into the post-surface reality)
**Prerequisite state (done):** derived index + FTS, content-hash identity, wiki-link edge
layer, Canvas/Note/Excalidraw/Hub reading surfaces, read-only MCP server, GoodNotes ingest.

## Organizing principle

> Astrolabe owns connections, intelligence, and dialogue — never content, and never the model.

Every layer below is derived and rebuildable (ADR-0005), rides BYOK or subscriber accounts
(D5 — no inference reselling), and is **independently usable** (phase-ends-usable law,
docs/06). Later layers are strictly composed from earlier ones.

Ordering is dependency, not time: data → view → contract → agents → tutor.

---

## Layer 1 — The machine edge layer: graphify as a connector

The index already carries the HUMAN edge layer (wiki-links, origin implicit). Graphify
contributes the MACHINE layer through the same architecture as every content source.

- **Graphify connector** (mirror-table pattern, like virtual collections): watch
  `graphify-out/graph.json` locations declared in the workspace manifest
  (`connectors.graphify.outputs: string[]`); mirror nodes + edges into index tables.
- **One edges substrate.** `origin` column unifies the layers:
  `wiki-link` (human) · `extracted` / `inferred` (graphify, its audit tags preserved) ·
  `asserted` (user curation, Layer 2) · `proposed` (agent petitions, Layer 3).
- **Provenance anchors** resolved to documents/notes by source path and content hash —
  a concept knows which pages and notes it came from.
- **Workflow:** run `/graphify` over vault subtrees or extracted book text externally;
  `--obsidian` concept notes land in the vault (already indexed; frontmatter-marked as
  generated so the lens can filter human vs machine notes); `graph.json` lands here.
- Astrolabe builds NO extraction pipeline. Graphify is the engine; Astrolabe is the surface.
  (When Orion — docs/09 — ever materializes, it lands as just another producer of the same
  edge substrate.)

**Usable alone:** concepts strip on hub/note/canvas; click a concept → everything it touches.

## Layer 2 — Seeing the second brain: the graph lens

- **Graph navigator** (Sigma.js, per docs/06 Phase 2): explore, filter by source / origin /
  recency; node → provenance panel → deep link to the exact page, note, or drawing.
- **Ego network in the document hub:** this document's concepts, their neighbors, the notes
  between them.
- **Curation:** confirm / reject / merge machine nodes; draw manual edges. User assertions
  (`asserted`) permanently outrank extractions.
- **Embeddings** (sqlite-vec, provider layer): semantic search joins FTS in the lens;
  nearest-neighbor similarity becomes one more edge origin.

**Usable alone:** wander the graph, land on sources — zero tokens, zero agents (vision §3:
the user's brain navigates for free).

## Layer 3 — MCP: the permanent contract between brain and agents

The existing read-only MCP server grows into THE second-brain API — the one interface every
agent consumes, forever (Claude Code today, ACP agents in Layer 4, Alioth-or-whatever later).

- **Read tools:** FTS + semantic search, graph neighborhood / path / concept queries,
  annotations, links/backlinks, reading state, collections, document detail.
- **Write tools, gated per capability** with in-app permission rules (default: off):
  - `synthesize_note` → written into the Obsidian vault as native Markdown (D3 write-back);
  - `tag` / `file_into_collection` → Eagle / Zotero via their own APIs;
  - `propose_edge` → lands as `origin: proposed`, pending user confirmation. Agents petition
    the graph; they never assert into it.
- Tool handlers remain the first draft of the context assembler (docs/06 §1.5) — retrieval
  = FTS + vector + graph-neighborhood, returned with provenance.

**Usable alone:** Claude Code/Desktop against the richer server — agentic Q&A over the full
graph, months before any in-app agent.

## Layer 4 — ACP: agents inside the surface

Astrolabe becomes an **ACP client** (the Zed role; official TS SDK):

- **Agent manager (main process):** spawn adapters as subprocesses — `claude-code-acp`,
  Codex, Gemini CLI — each a config row (command/args/env), not code. Session lifecycle,
  streamed updates, `session/request_permission` routed to UI prompts.
- **Auth = subscriber accounts.** The agent CLIs hold their own logins (Claude Pro/Max,
  ChatGPT). Astrolabe stores no keys, meters nothing. Amends D5: subscriptions are the
  day-to-day path; BYOK remains for batch/extraction work.
- **Context = Layer 3.** Every `session/new` mounts the index MCP server; agents wake up
  already knowing the library (vision §1: zero discovery-token burn).
- **Skills come free:** the real Claude agent runs against the real `~/.claude` environment
  (`/graphify` included) — no porting.
- **Dialogue pane** beside the lens: streaming, tool-call visibility, permission prompts,
  agent picker. Dialogues persist to `.astrolabe/dialogues/` as first-party artifacts,
  LINKED to the graph nodes they discussed — conversations join the graph they were about.
- Read-only sessions ship first; Layer 3 write gates arrive per capability.

## Layer 5 — The learner model: the user as the objective function

The endgame inverts the agent loop: a task agent optimizes task completion; this agent's
loss function is the USER'S KNOWLEDGE STATE. Intelligence augmentation, made literal.

- **Knowledge-state overlay** — per graph node, evidence of engagement, all from existing
  streams: *read* (Canvas/lightbox reading state — the deferred heat layers' purpose),
  *annotated* (indexed), *written-about* (wiki-links from the user's notes), *discussed*
  (dialogue links), *recalled* (answers to the tutor's own questions). Mastery × recency
  as a function over the graph. Derived, rebuildable, private, on-device.
- **Goals** — first-party artifacts (`.astrolabe/goals/`): a designated target subgraph.
  The objective is mastery over subgraphs the USER chose — not engagement, not completion.
- **The loop:** observe (sync events: new annotations, reading sessions, notes — zero
  tokens) → diagnose (frontier nodes adjacent to known but untouched; prerequisite gaps
  along edge directions; high-centrality-never-read concepts; mastery decayed past its
  recency half-life) → intervene (Socratic questions grounded in the user's OWN sources
  with jump-to-page citations; "read pages 140–162 next"; worksheets from their own
  annotations; spaced-repetition prompts) → measure the response → update the overlay.
- **Architecture:** a harness pattern, not a system — an ACP agent (Layer 4) + a tutor
  system prompt + the MCP contract (Layer 3) + the knowledge-state tables. No custom model,
  no new principles, no new storage class.

## Sequencing law (restated for this scope)

Each layer ships something personally usable with the layers below it and nothing above it.
There is never an infrastructure phase that ships nothing — the audit's lesson (docs/01),
applied to intelligence. Graph data before graph view; contract before consumers; agents
before the tutor; the tutor only when reading state, graph, and dialogue all exist to
observe the learner through.

## Explicitly out, permanently

- No extraction/inference pipeline inside Astrolabe while graphify serves (revisit = Orion).
- No inference reselling; no cloud copy of the graph or the learner model.
- No agent writes that bypass the origin/permission gates — `proposed` is the ceiling of
  agent authority over the graph.
