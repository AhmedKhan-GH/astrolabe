# 06 — Roadmap

**Status:** Living document · **Founding plan:** 2026-07-07 · **As-built rewrite:** 2026-07-12

Sequencing law, derived from the audit: **every step ends with something the builder personally
uses.** Infrastructure exists only in service of what ships with it. The previous iterations
inverted this and died; this ordering is load-bearing. (Durations are omitted — with AI-assisted
implementation, wall-clock estimates are meaningless; sequence by dependency only.)

---

## Where we actually are (2026-07-12)

The founding plan (below, preserved for record) was strictly linear: library → graph → agent →
ink → reader → commercialize. **Reality diverged, deliberately and successfully:** Phase 1 (the
library) shipped in full, then the build *jumped to the agent* (founding Phase 3) ahead of the
graph (Phase 2), because the ACP agent only needed the already-built MCP seed. The reconciler,
notes, hub, and Canvas grew as Phase-1.5 additions. Nothing was wasted; every piece shipped usable.
The one conspicuous gap: **the knowledge graph — the founding v1-essential (D4) — is still unbuilt.**
We have the library and the agent; not yet the mind.

### Done (on `main`, tested green: ~497 unit / ~167 integration / 6 e2e)

- **Shell** — Electron 3-process, strict TS, better-sqlite3 + Drizzle, typed-IPC allowlist, macOS
  TCC flow, signed dev-install, CI.
- **Connectors** (`src/main/connectors/`) — Zotero, Eagle, Obsidian: incremental sync, content-hash
  identity, removal sweep + orphan-source prune. (GoodNotes built then removed — Excalidraw is the
  ink surface; see [[ink-decision]] / docs/2026-07-10-implementation-plan-notes-hub-ink.md.)
- **Derived index** (`src/main/index/`) — upsert, sync, FTS, queries (browse/search/nav/document/
  page-annotations), the wiki-link `links` graph, reconcile (Eagle↔Zotero writes), removals.
- **Workspace artifacts** (`.astrolabe/`) — saved views, virtual collections, dialogues (first-party).
- **Library lens** (`src/renderer/src/lens/`) — nav rail, recency river, boolean filtering, presence
  facet, saved views, virtual collections; **Canvas** (PDF-at-a-glance + annotation heat); **NoteView**
  (markdown + live wiki-links + backlinks); **Excalidraw** read-only; the **Document Hub**.
- **The agent** (`src/mcp/` + `src/main/acp/` + `src/renderer/src/dialogue/`) — MCP server (8 read
  tools) mounted into a CLI-grade **ACP client**: Claude + Codex on the user's subscriptions,
  thinking/tool-cards/diffs/plans, model+effort config, real permissions, history browser, packaged.

## Forward roadmap — seven tracks

Tracks are parallelizable except where a dependency is noted (→). Phases inside a track are
ordered; each ends usable (the sequencing law). Statuses: ✅ done · ◐ in progress · ○ planned.

### Track 0 — Consolidation ◐ (nearly done)
- ✅ Merge to `main`; branch cleanup; roadmap grounded (this rewrite).
- ✅ **Safe-reads permission allowlist** — auto-approve read-only index/fetch tools, keep prompting
  on Bash/writes; keeps permission prompts meaningful, not fatiguing ([[agent-isolation-decision]]).
- ✅ **Continuable past chats** — resume a history dialogue via ACP `session/load` (Claude + Codex).
- ○ **Command enrichment** (the last item; lowest value) — an app-command registry surfaced in the
  slash palette: *action commands* handled locally (`/canvas`, `/hub`, `/note`, `/search`) and
  *prompt-template commands* that expand into a grounded prompt (`/synthesize`, `/contradict`).
  (NOT "MCP prompts as commands" — in ACP the agent is the MCP client, so those don't surface here.)

### Track A — Experience / Navigation ○ (independent of everything)
Make what exists feel like a product you navigate fluidly. Replaces the overlay-panel model (no
persistent spatial model, no back/forward) with:
- A1. **Three-pane spine** — source/tree → item list → inspector (the panels become inspector
  contents). A2. **⌘K quick-switcher** + **command palette**. A3. Appearance polish.

### Track R — The Reader ✅ (shipped 2026-07-13; founding Phase 5)
The in-app PDF experience, spanning effortless navigation and deep focused reading. Salvaged
iteration-1's `buildPageMap` / `findTocPathsForPages` / lazy-thumbnail algorithms as pure fns.
- R1 ✅ Canvas: continuous document-relative heat (count | **depth** by annotation substance |
  **read** by dwell), grid cell-size ladder down to a 32px whole-book overview, lightbox
  zoom + fit modes. Specs: `2026-07-13-r1-canvas-heat-zoom-spec.md`.
- R2 ✅ Continuous-scroll Reader: pdf.js text layer, ⌘F find, zoom, Finished toggle, and
  **reading-state** (`.astrolabe/reading/<sha>.json`, per-page dwell/visits/timestamps —
  exposure, never comprehension) → feeds Track L. Spec: `2026-07-13-r2-reader-reading-state-spec.md`.
- R3+R3c ✅ Structure: TOC sidebar (live current-section), minimap (notes|read heat), saveable
  **page-range Views** (`.astrolabe/page-views/<sha>.json`, TOC-path provenance) applying across
  Reader AND Canvas (non-members dimmed), two-page spread, thumbnail rail, focus mode, find-match
  text-layer highlighting (CSS Custom Highlight API). Specs: `2026-07-13-r3-structure-views-spec.md`,
  `2026-07-13-r3c-reader-completion-spec.md`. (Dropped: a Canvas heat minimap — the 32px grid IS
  the overview.)

### Track O — OCR / Scanned-document extraction ○ (→ prerequisite for Track B on scanned PDFs)
Make picture-scan PDFs first-class, extracted ONCE and stored durably (extract-once / query-forever).
- O1. **Text-layer detection + local OCR** — reuse any existing hidden text layer (free); else a
  modern *local* engine (PaddleOCR/Surya, NOT Tesseract) on-device. Benchmark on real scans; keep
  the engine swappable.
- O2. **Cheap text-only LLM correction** (BYOK) — fix OCR typos from the text alone (no image → far
  cheaper than vision).
- O3. **Confidence-gated escalation** — send ONLY low-confidence pages to a cloud OCR API / cheap
  vision model. 90% resolve free/local; you pay only for the hard 10%.
- O4. **Durable OCR cache + integrations** — cache per-page text (+ bounding boxes) keyed by content
  hash in `.astrolabe/ocr/` (a Rebuild never re-OCRs; the same scan in Eagle+Zotero is OCR'd once);
  render OCR as a selectable text layer over the scan in the Reader (in-view OCR); optional
  vision-describe-figures-once for image content. Feeds FTS → embeddings → graph. Local-first by
  default; cloud/vision tiers are opt-in BYOK (D5).

### Track B — The Mind (the deferred founding core, D4) ○
The knowledge graph, low-friction on-ramp first. Full detail: docs/2026-07-10-intelligence-layer-roadmap.md.
- B1. **Embeddings + semantic search** (sqlite-vec) — meaning-based edges Obsidian can't make; no
  extraction pipeline. The cheapest first taste of the differentiated graph.
- B2. **Graphify connector** — the machine edge layer joining the human wiki-link layer in one
  origin-tagged substrate (Layer 1).
- B3. **Graph lens + curation** — see and shape the second brain (Layer 2).
- B4. **Extraction pipeline** ("Orion", docs/09) — concepts/claims/entities as nodes. (OCR text from
  Track O is what makes scanned pages embeddable/extractable.)

### Track L — The Learner Model ○ (Layer 5; far horizon; fully spec'd)
The user as objective function; cognitive-offloading-aware tutoring. Spec:
docs/2026-07-12-learner-model-pedagogy-spec.md. **Gated on Track R2 (reading-state) + Track B (graph).**
- L1. Passive knowledge-state overlay (a pure mirror). L2. The metacognitive mirror (fluency vs.
  retrieval gap). L3. Retrieval + spacing on user-flagged internalize nodes. L4. Full adaptive loop.
  L5. Reflexive grounding (ingest the pedagogy corpus).

### Track C — Commercialization ○ (last)
The `alidade` licensing backend (founding Phase 6). Open decision: one-time vs. subscription
([[alidade-commercial-backend]], docs/05). Signing/notarization + updater + website.

## Dependency map & recommended sequence

```
Track 0 (finish) ─┐
Track A  ─────────┼─ independent, any time (experience)
Track R  ─────────┘   R2 ─┐
Track O  ────────────────┼→ Track B ──→ Track L
                          │   (B needs OCR text for scanned PDFs)
                     (L needs R2 reading-state + B graph)
Track C  ── last
```

**Recommended:** close Track 0 (or skip command enrichment), then **Track R1** — it fixes the
Canvas irritations you named, is small, and lays the heat/zoom/reading-state groundwork the rest of
R (and L) builds on. In parallel or next, the fork you keep circling: **Track A** (daily-driver
feel) vs. **Track B/O** (the differentiated mind). OCR (Track O) is the unlock that makes scanned
material — currently dead weight — part of both search and the eventual graph.

---

## The founding phase plan (2026-07-07, preserved for record)

The original linear plan. Superseded by the as-built reality above, but kept because its
per-phase detail (especially Phases 2/5 — the graph and the reader) still informs Tracks A/B.

---

## Phase 0 — Foundation (week 1)

**Goal:** a running, typed, tested Electron shell with CI. No product features.

- Vite React-TS scaffold (done via WebStorm wizard) → **Electron graft as its own commit**:
  `electron-vite` three-target structure, secure defaults (contextIsolation, no nodeIntegration),
  boot order main → IPC → window
- Strict tsconfigs (port alidate's), ESLint flat config, Pino, Vitest + Playwright-for-Electron
  smoke test (app launches, window renders)
- better-sqlite3 + Drizzle wired with the **typed IPC/table-client pattern** (salvaged from
  iteration 2), native-module rebuild configured
- GitHub Actions: typecheck + lint + test on push
- `CLAUDE.md` adapted from alidate's `AI_BEST_PRACTICES.md`
- ADRs recording the irreversible decisions ([`docs/adr/`](adr/) — the founding set 0001–0007 already
  written: orchestrator, Electron final, two repos, BYOK, derived index, test altitude, phase-ends-usable)

**Usable that week:** `pnpm dev` opens a signed-in-nothing, empty-but-real desktop app; CI is green.

## Phase 1 — Connectors & the unified library (weeks 2–4)

**Goal:** Astrolabe shows everything you have, across tools, in one place — zero AI yet.

- `.astrolabe/` workspace with `manifest.json` (versioned from day one)
- **Obsidian connector**: chokidar watcher, Markdown/frontmatter/wiki-link parsing, incremental
  re-index
- **Zotero connector**: local API read — items, collections, attachments, **annotations**,
  incremental sync by modification time
- **Eagle connector**: localhost API read — items, folders, tags, thumbnails
- Index schema v1: sources, documents, notes, assets, annotations, provenance URIs; **FTS5** over
  all extracted/parsed text
- **Library lens UI**: unified search-and-browse across all three sources; every result deep-links
  out (`zotero://`, `obsidian://`, `eagle://`); TanStack Query over IPC
- "Rebuild index" action — proving the derived-and-rebuildable law from the start

**Usable that week:** one search box over the entire Zotero library + vault + Eagle, with instant
jump-to-source. Already daily-driver material, before any AI.

### Phase 1.5 — interim agentic access (days, not weeks)

A thin **MCP server over the index** (`search_library`, `get_annotations`, `resolve_provenance`,
read-only stdio process) so Claude Code/Desktop act as the interim harness — agentic Q&A grounded in
the index with zero discovery-token burn, months before Alioth. Its tool handlers are the first
draft of Alioth's context assembler and are consumed by Phase 3. Detailed in
[the 2026-07-09 implementation spec](specs/2026-07-09-runway-to-library-lens.md).

## Phase 2 — The graph (weeks 5–9)

**Goal:** the knowledge graph exists, grows on ingestion, and is navigable. The v1 essential (D4).

- PDF text extraction pipeline (pdf.js in a worker/utility process) feeding FTS + extraction
- **Extraction pipeline — Orion's core** (see [09](09-orion-research.md); the graphify two-layer
  pattern): cheap-model passes propose concepts/
  claims/entities + candidate edges with provenance anchors; batched, resumable, cost-visible;
  BYOK/Ollama via the provider layer
- Embeddings → **sqlite-vec**; semantic search joins FTS in the library lens
- Graph schema: typed nodes/edges, confidence, origin (extracted vs user-asserted), provenance
- **Graph navigator UI** (Sigma.js): explore, filter by source/type/recency, node → provenance
  panel → deep link
- User curation: confirm/reject/merge extracted nodes, add manual edges (user assertions outrank
  extractions)

**Usable that week:** ingest a paper collection, watch a mind assemble, wander it, and land on exact
source pages.

## Phase 3 — Alioth (weeks 10–14)

**Goal:** the agent harness — dialogue grounded in the graph, with write-back.

- **Context assembler**: request → FTS + vector + graph-neighborhood retrieval → assembled subgraph
  + excerpts + provenance in the prompt
- Dialogue surface with streaming; every claim carries jump-to-source
- **Skills v1**: `navigate` (answer + jump targets), `synthesize` (grounded note → **written into
  the Obsidian vault** as native Markdown), `connect` (propose edges → user confirms)
- Dialogues persisted to `.astrolabe/dialogues/`, linked to discussed nodes
- BYOK key management UI (safeStorage), model routing (cheap extraction / strong synthesis),
  token-spend visibility

**Usable that week:** ask your library questions; get answers that cite themselves; save syntheses
that appear in Obsidian as if you wrote them.

## Phase 4 — Ink ingestion (weeks 15–17)

**Goal:** handwritten notes join the graph (D2).

- Watched inbox + manual import of PDFs/images from iPad apps or scans; copies into
  `.astrolabe/ink/`
- OCR via vision model (provider layer; Tesseract fallback); extracted text → FTS + extraction
  pipeline → graph
- Ink pages linkable as provenance like any other source

**Usable that week:** a GoodNotes export becomes searchable, graphed, citable knowledge.

## Phase 5 — The reader (weeks 18–24)

**Goal:** one continuous flow (D1) — reading moves in-app; v2 begins.

- Embedded **pdf.js viewer with text layer**: continuous scroll, TOC tree, thumbnails (salvaged
  lazy-rendering pattern)
- Highlights/annotations created in-app, **written back to Zotero's annotation store** (Zotero
  remains system of record)
- **Views return** (iteration 1's crown jewel): saved TOC/page-range subsets per document, powered
  by the salvaged `buildPageMap` + `findTocPathsForPages` algorithms — ported as pure functions,
  with tests
- **Reading state** (D4's second layer): position, progress, resume across the library
- Alioth beside the page: current section as ambient context

**Usable that week:** read, highlight, ask, and file insights without leaving Astrolabe; Zotero
still owns every byte.

## Phase 6 — Commercialization (weeks 25–30)

**Goal:** sellable. Only now does the second repo exist.

- **Create `alidade`**: Express + Drizzle + managed Postgres; the five endpoints + Paddle webhook
  (see [05](05-licensing-and-commercialization.md))
- License UI in-app: key entry, activation, offline verification, self-serve deactivation page
- Signing + notarization; electron-updater + R2; release pipeline in GitHub Actions (the *unsigned*
  local per-device packaging — `electron-builder.yml` + `package:{mac,win,linux}` — was pulled
  forward to Phase 0 for dogfooding; this phase adds signing, the updater feed, and the CI matrix)
- Astro website: landing, docs, checkout, downloads
- Sentry + PostHog (opt-in); beta cohort from the Zotero/Obsidian/Eagle communities

**Usable that week:** a stranger can buy, activate, and update Astrolabe without talking to you.

---

## Deferred beyond beta (recorded, not forgotten)

- Dialogue memory and task/intent state as first-class graph feeders (D4's remaining layers)
- Hosted E2E-encrypted `.astrolabe/` sync (alidade v2, post-revenue; D11)
- Managed-AI subscription tier (D5 note)
- Plugin API; mobile companion; additional connectors (browser bookmarks, email, arXiv feeds)

## Standing risks & watch items

- **Zotero local API stability** — the one connector dependency worth monitoring; Obsidian is plain
  files (no risk), Eagle's API is stable
- **Extraction cost/quality on BYOK** — keep pipelines batched, resumable, and cost-visible so users
  trust the ingestion spend
- **Scope gravity toward rebuilding the tools** — the audit's central lesson; the answer to "should
  Astrolabe also manage/store X?" defaults to *no, link to the system of record*
