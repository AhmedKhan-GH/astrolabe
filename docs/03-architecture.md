# 03 — Architecture

**Status:** Current — founding design session (Alioth/Orion split added) · **Date:** 2026-07-07

## The six layers

```
┌─ ASTROLABE (Electron + React) ──────────────────────────────────┐
│  Graph navigator · Library lens · Dialogue surface · Views      │
│  Deep links out: zotero:// obsidian:// eagle://                 │
├─ ALIOTH (agent harness, main process) ──────────────────────────┤
│  Context assembler (graph → prompt) · Provider layer            │
│  (BYOK Anthropic/OpenAI · Ollama) · Persistent dialogues        │
│  Skills: extract · connect · synthesize · navigate              │
├─ THE INDEX (SQLite: graph + FTS5 + sqlite-vec) ─────────────────┤
│  Nodes, edges, embeddings, extracted text, provenance URIs —    │
│  derived, rebuildable, never a system of record                 │
├─ ORION (knowledge engine, main process) ────────────────────────┤
│  Extraction passes · Embeddings · Entity resolution             │
│  Graph maintenance — batched · resumable · cost-visible         │
├─ CONNECTORS (deterministic, zero-token) ────────────────────────┤
│  Zotero local API · Obsidian vault (file watcher) ·             │
│  Eagle localhost API · Ink ingestion (import + OCR)             │
└─ SYSTEMS OF RECORD (user-owned, open formats) ──────────────────┘
   Zotero DB/storage · Markdown vault · Eagle library · iPad/paper
```

Everything above the bottom layer ships inside the Electron app. The bottom layer belongs to the
user and to the third-party tools; Astrolabe never becomes its owner.

## Layer 1 — Systems of record

- **Zotero**: papers, bibliographic metadata, collections, and PDF annotations (highlights, notes)
  stored in Zotero's own SQLite + storage directory. Synced by Zotero's own sync if the user
  enables it.
- **Obsidian vault**: typed notes as plain Markdown files with wiki-links. Synced by whatever the
  user already uses (Obsidian Sync, iCloud, Syncthing).
- **Eagle library**: visual assets (images, screenshots, design references) with tags/folders in
  Eagle's library format.
- **Ink sources**: iPad apps (GoodNotes, Notability, Apple Notes) exporting PDFs/images, or paper
  scans. Not a live system of record — a feed into the ingestion pipeline (D2).

## Layer 2 — Connectors (deterministic, zero-token)

Plain TypeScript modules in the Electron main process. No LLM in the loop; they run on schedules,
file-watchers, and app events.

- **Zotero connector**: Zotero's local HTTP API (Zotero 7+, keyless local mode — already proven by
  the user's patched zotcli setup). Reads items, collections, attachments, annotations, and
  modification timestamps for incremental sync. Writes: creating items/notes where the design calls
  for write-back.
- **Obsidian connector**: no API needed — the vault is files. `chokidar` watcher + Markdown parsing
  (frontmatter, wiki-links, tags). Writes: new Markdown notes (Alioth syntheses) into a designated
  folder, in Obsidian-native format, so Obsidian treats them as its own.
- **Eagle connector**: Eagle's localhost HTTP API (port 41595) for items, folders, tags, and
  thumbnails.
- **Ink ingestion**: watched inbox folder + manual import; copies (not references) into the
  workspace, runs OCR via the provider layer (vision-capable model; Tesseract local fallback),
  stores extracted text + links in the index.

Each connector implements a common interface (`scan()`, `watch()`, `resolve(uri)`, optional
`write()`), is independently disableable, and degrades gracefully: a broken connector dims one
source, never the app. This replaces the alidate iteration's speculative `ServiceFactory`
local/remote seam with seams that earn their existence immediately.

## Layer 3 — Orion (the knowledge engine)

The programmatic engine between the connectors and the index: it turns what the connectors deliver
into the knowledge network — text acquisition, extraction, embedding, entity resolution, and graph
maintenance. Orion is deterministic orchestration around batched model passes; it has no dialogue
surface and is never summoned — it runs on ingestion events. Full treatment in
[09 — Orion Research](09-orion-research.md).

Graph construction is Orion's job and the one token-spending pipeline: at ingestion, new/changed
content flows through extraction passes (batched, resumable, progress-visible — the two-layer
pattern proven by the user's graphify/business-mind builds: cheap-model reading passes,
stronger-model synthesis passes). Costs are incurred once per document, not per query. Model calls
route through the same provider layer Alioth uses; everything around them is plain code.

## Layer 4 — The index (SQLite)

One `better-sqlite3` database, schema managed by Drizzle, living in the `.astrolabe/` workspace.
Three cooperating capabilities in one engine:

1. **Relational graph storage** — `nodes` (concepts, claims, entities, documents, notes, assets,
   dialogues), `edges` (typed, directed, with confidence and origin: extracted vs user-asserted),
   `provenance` (every node/edge anchors to source URIs)
2. **FTS5** — full-text search over extracted document text, notes, annotations, OCR'd ink
3. **sqlite-vec** — embedding vectors for semantic search and graph-neighborhood retrieval

**The index is derived and rebuildable — this is architectural law.** A "Rebuild index" action must
always exist and always work. No user data may live only in the index. Provenance URIs
(`zotero://select/...`, `obsidian://open?vault=...&file=...`, `eagle://item/...`, plus page/section
anchors using the TOC path-string scheme from iteration 1) are the join keys between the graph and
reality.

## Layer 5 — Alioth (the agent harness)

Lives in the main process; the renderer talks to it over typed IPC. Full treatment in
[08 — Alioth Intelligence](08-alioth-intelligence.md).

- **Provider layer**: one abstraction (Vercel AI SDK) over Anthropic / OpenAI / Ollama. BYOK keys in
  the OS keychain (`safeStorage`), never in the DB or config files. Model routing per task class:
  cheap models for extraction sweeps, strong models for synthesis and dialogue.
- **Context assembler**: the heart of the token economics. Given a user request, it queries the
  index (FTS + vector + graph traversal), assembles the relevant subgraph + source excerpts +
  provenance into the prompt, and hands the model a pre-built context instead of tools to wander
  with. Tool calls exist but are the exception (deep-dive into a specific document), not the
  navigation mechanism.
- **Skills**: named, typed operations — `extract` (document → graph candidates), `connect` (find
  and propose edges), `synthesize` (write a grounded note, delivered into the vault), `navigate`
  (answer + jump targets). Each skill declares its context recipe and write permissions.
- **Dialogues**: persisted as files in `.astrolabe/dialogues/` (Markdown + JSON metadata), linked to
  the nodes/documents they discussed. In v1 they are stored and linkable; becoming first-class graph
  feeders is a later layer (D4).

## Layer 6 — Astrolabe (the interface)

- **Graph navigator**: Sigma.js (WebGL) canvas over the node/edge tables; filter by source, type,
  recency, confidence; click node → provenance panel → deep link into the owning tool
- **Library lens**: unified cross-tool search and browse (FTS + vectors) across Zotero items, vault
  notes, Eagle assets, ink — read-only aggregation, zero tokens
- **Dialogue surface**: conversation with Alioth, every claim carrying jump-to-source affordances
- **Views**: saved named lenses (query + filter + pinned nodes) — the iteration-1 Views concept
  generalized from "subset of one document" to "subset of the knowledge space"; document-level Views
  return with the v2 reader
- **v2: the reader** — embedded pdf.js viewer with text layer, so reading, highlighting (written
  back to Zotero's annotation store), and AI-beside-the-page happen in-app; until then, deep links
  into Zotero's reader (D6)

## Token economics by layer

| Activity | Layer | Token cost |
|---|---|---|
| Sync, watching, parsing, thumbnailing | Connectors | Zero — pure code |
| Keyword/semantic search, graph browsing, deep links | Index + UI | Zero — local queries |
| Graph construction (extraction, embedding) | Orion pipelines | Once per document, at ingestion; batched and resumable |
| Dialogue, synthesis, connection-finding | Alioth | Per deliberate invocation; cheap because context is pre-assembled |

This table is the answer to "why not just point Claude Code at MCP servers": a generic harness pays
tokens for discovery on every session; Astrolabe pays once at ingestion and navigates for free.

## Write-back rules

Writes always land in the system of record that owns the data type, in its native format:

- Alioth synthesis / permanent note → Markdown file in the Obsidian vault (designated folder,
  frontmatter marking provenance)
- New reference discovered → Zotero item via connector
- Highlight/annotation (v2 reader) → Zotero annotation store
- Dialogue, View, graph annotation → `.astrolabe/` workspace (Astrolabe's only first-party data)

Nothing is ever written that the owning tool cannot read natively.

## The `.astrolabe/` workspace

A versioned, self-contained directory (successor of the alidate `.astro` bundle, with an explicit
`manifest.json` carrying schema version and connector config):

```
.astrolabe/
  manifest.json          # version, connector configs (no secrets), workspace identity
  index.db               # the derived SQLite index (rebuildable; excluded from backup advice)
  dialogues/             # Markdown + JSON, portable
  views/                 # JSON view definitions
  ink/                   # imported handwriting (copies) + OCR sidecars
```

Small, file-based, and syncable by the user's existing mechanism — which is the entire multi-device
story (D11): synced sources + rebuildable index + file-synced workspace = no sync backend.

## Non-goals (recorded so they stay dead)

- No PowerSync/ElectricSQL/CRDT replication layer — there is no cloud source of truth (D11)
- No cloud storage of user content, ever, in the core product
- No native ink/drawing surface (D2)
- No plugin API in v1 (revisit post-revenue)
- No Notion-style hosted accounts (D7)
