# 06 — Roadmap

**Status:** Living document — phase status updated as work lands · **Date:** 2026-07-07 (Phase 0 pending)

Sequencing law, derived from the audit: **every phase ends with something the builder personally
uses that week.** Infrastructure exists only in service of the phase it ships in. The previous
iterations inverted this and died; this ordering is load-bearing.

Durations are honest solo-developer estimates with AI-assisted development; they compound to a
sellable beta in roughly 5–7 months.

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
