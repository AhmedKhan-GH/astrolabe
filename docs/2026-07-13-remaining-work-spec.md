# Astrolabe — Remaining Work Spec (session handoff)

**Date:** 2026-07-13 · **Purpose:** a self-contained starting point for a NEW chat with no memory
of the build sessions. Read this top-to-bottom once; it points to the deeper per-feature specs.

---

## 0. Orientation — what to read and how to work

- **This doc** = the remaining-work map + execution conventions.
- **The roadmap** = `docs/06-roadmap.md` (as-built state + the seven forward tracks, dependency map).
- **Deep specs already written** (reference, don't re-derive): `docs/2026-07-10-intelligence-layer-roadmap.md` (graph/MCP/ACP/learner layers), `docs/2026-07-12-learner-model-pedagogy-spec.md` (Track L, cognitive-science grounded), the per-feature specs under `docs/` and `docs/specs/`.
- **Founding intent** (immutable): `docs/00-vision.md`, `docs/02-design-decisions.md` (D1–D13), `docs/adr/0001–0007`. Do not relitigate these.
- **Auto-memory** (loaded each session; treat as background, verify before acting): no-time-estimates, agent-isolation-decision, ink-decision-excalidraw, macos-signing-tcc-setup, astrolabe-tool-pain-map, alidade-commercial-backend.

## 1. What Astrolabe is (inviolable principles)

A local-first knowledge environment that ORCHESTRATES the user's existing tools (Zotero = citations
+ annotations, Obsidian = notes, Eagle = library) and adds the intelligence layer none of them have.

- **Owns no content — only connections, intelligence, dialogue** (and, later, a knowledge model).
  Every byte in the index is derived from a system of record and rebuildable (ADR-0005).
- **Content-hash (SHA-256) identity** is load-bearing: the same PDF in Eagle and Zotero dedupes to
  one document with two provenance anchors.
- **First-party artifacts** live as open JSON/Markdown in `.astrolabe/` (views, collections,
  dialogues, goals) — portable, file-syncable, survive a rebuild.
- **BYOK / subscriber accounts** for AI; no inference reselling (D5). Local-first; cloud is opt-in.
- **The agent is open by design, gated by consent, not sandboxed** ([[agent-isolation-decision]]):
  broad capability so it can pull external resources; safety = permission cards (safe reads
  auto-approved, mutations prompt), not confinement.
- **Ink surface = Excalidraw in the vault** ([[ink-decision-excalidraw]]); GoodNotes was built then
  removed. Don't propose export-pipeline connectors again.
- **No time estimates** ([[no-time-estimates]]): sequence by dependency, never quote days/weeks.

## 2. As-built state (shipped on `main`, all gates green)

~512 unit / ~170 integration / 6 e2e. Signed dev-install to `/Applications/Astrolabe.app`.

- **Shell**: Electron 3-process (main/preload/renderer), strict TS, better-sqlite3 + Drizzle, typed
  IPC allowlist, macOS TCC access flow, CI.
- **Connectors** (`src/main/connectors/`): Zotero, Eagle, Obsidian — incremental sync, content-hash
  identity, removal sweep + boot-time orphan-source prune.
- **Index** (`src/main/index/`): upsert, sync, FTS, queries (browse/search/nav/document/
  page-annotations), the wiki-link `links` graph, reconcile (Eagle↔Zotero writes), removals.
- **Library lens** (`src/renderer/src/lens/`): nav rail, recency river, boolean filtering, presence
  facet, saved views, virtual collections; **Canvas** (PDF thumbnail grid + annotation heat +
  lightbox); **NoteView** (markdown + live wiki-links + backlinks); **Excalidraw** read-only;
  **Document Hub**.
- **Agent** (`src/mcp/` + `src/main/acp/` + `src/renderer/src/dialogue/`): MCP server (8 read tools)
  mounted into a CLI-grade **ACP client** — Claude + Codex on subscriptions, thinking/tool-cards/
  diffs/plans, model+effort config, real permissions (safe-reads auto-approve), history browser,
  continuable past chats (session/load).

## 3. Architecture & code map

```
src/main/
  connectors/{zotero,eagle,obsidian}/  registry.ts types.ts   # read connectors; content-hash identity
  index/     upsert sync queries links reconcile removals nav-tree sync-status   # the derived index
  lib/       vcollections views workspace hash logger slug zotero-write eagle-write  # artifacts + write clients
  acp/       adapters manager update-map permission-policy dialogue-store   # the ACP client
  system/    access doc-protocol         # TCC probe; astro:// scheme (Canvas byte serving)
  db/        schema.ts (Drizzle)          # tables: sources, documents(+instances), tags, collections,
                                          #   annotations, links, virtual_collections(+members), meta, search_fts
mcp/         server run handlers db       # stdio MCP server; esbuild-bundled to out/mcp/server.mjs
shared/      db-ipc.ts                    # ALL named IPC channels + zod schemas + shared types (the seam)
preload/     index.ts                     # the contextBridge allowlist (window.astrolabe.*)
renderer/src/lens/       Lens + panels (Canvas/Note/Hub/Excalidraw) + rail/river/filters
renderer/src/dialogue/   DialoguePane + transcript reducer + Tool/Thought/Plan/Permission cards
```

Key conventions: joins/FTS use **named IPC channels** (never the generic table-client); every channel
has a **zod schema** at the boundary (`shared/db-ipc.ts`); renderer keeps **local type mirrors** of
wire types so component tests don't reach the preload.

## 4. Working conventions (the build loop)

1. **Spec before code.** Non-trivial work gets a short `docs/` spec first (brainstorm → spec → build).
2. **TDD scaled to stakes × logic** (global CLAUDE.md): failing test first for anything that branches/
   transforms/enforces a rule; don't test design tokens/copy/config.
3. **Opus subagents for token-heavy work**, orchestrated against a **frozen wire contract** (define the
   exact `shared/db-ipc.ts` types in the spec so parallel main+renderer agents don't race the seam).
   Keep orchestration/integration/commits in the main loop.
4. **Verify → commit → reinstall.** Gates: `pnpm typecheck` (node/web/mcp) · `pnpm test:unit` ·
   `pnpm test:integration` · `pnpm test:e2e`. Then commit; then `pnpm dev:install:mac` to dogfood.
   Re-run the packaged adapter smoke (`scripts/packaged-adapter-smoke.ts`) after ANY `src/main/acp/`
   spawn-path change.
5. **Commit trailer:** `Co-Authored-By: <model> <noreply@anthropic.com>`. Branch off `main`; merge
   fast-forward when green; delete the branch.

### Test tiers (ADR-0006)
- **unit** (vitest, jsdom/node): pure logic + React components; NO native sqlite.
- **integration** (`*.itest.ts`, run via electron-as-node): real SQLite + migrations.
- **e2e** (`e2e/*.spec.ts`, Playwright): launch smoke; asserts the preload allowlist.

### Known gotchas (WILL bite otherwise)
- **dev-install needs Node 24**, not Homebrew Node 25 (electron-builder 26 breaks on 25 — silent
  "app not found" at signing). WebStorm's runtime is Node 24; use it or `node@24` on PATH.
- **Packaged ACP spawning**: adapters + the MCP server run as spawned node/native processes and CANNOT
  load ESM entries or native binaries from inside `app.asar`. `adapters.ts` `unpackedPath()` rewrites
  `app.asar`→`app.asar.unpacked`; `electron-builder.yml` `asarUnpack` ships `out/mcp/**`,
  `@agentclientprotocol/**`, `@anthropic-ai/**`, `@openai/**`, `zod/**`, `@modelcontextprotocol/**`,
  `bindings/**`, `file-uri-to-path/**`. Spawned node uses `ELECTRON_RUN_AS_NODE=1`. An unpacked
  process's require walk sees ONLY `app.asar.unpacked/node_modules` — unpack a spawn target's whole
  runtime closure.
- **Flakes** (rerun, not real): the `removals.itest.ts` 10⁴-row scale test can time out under load;
  the e2e launch smoke occasionally flakes on the macOS sign step. Isolate-run to confirm.
- **A local commit hook may fire** during packaging — verify `git log` after packaging; a subagent
  once mistook a real commit for a stray hook and reset it. Always check reality after background work.

## 5. Standing decisions & constraints

- **ADRs** (`docs/adr/`): 0001 orchestrator-owns-no-content · 0002 electron-final · 0003 two-repos ·
  0004 BYOK+local · 0005 derived-rebuildable-index · 0006 test-altitude · 0007 phase-ends-usable.
- **Agent isolation**: NO sandbox by choice (knowledge engine must pull external resources); consent
  via permission cards; safe-reads auto-approved (`permission-policy.ts`), mutations prompt.
- **Excalidraw is the ink surface**; GoodNotes removed. OCR work (Track O) targets scanned PDFs, not
  ink.
- **Alidade** (commercial backend) is a separate Go repo with its own SPEC; pricing model (one-time
  vs subscription) is OPEN. Last track.

---

## 6. The remaining tracks

Statuses: ✅ done · ○ planned. Tracks parallelize except where → notes a dependency. Full track/
dependency map: `docs/06-roadmap.md`.

### Track 0 — Consolidation (only one item left)
**○ Command enrichment** (lowest value). An app-command registry surfaced in the existing slash
palette (`DialoguePane.tsx`, which already filters `transcript.availableCommands`):
- **Action commands** handled LOCALLY (intercept in `send()` before `acp.prompt`): `/canvas [title]`,
  `/hub [doc]`, `/note [title]`, `/search <q>` → call the existing `onOpenCanvas`/`onOpenHub`/lens
  callbacks. Show in the palette in an "Astrolabe" group.
- **Prompt-template commands** that EXPAND into a grounded prompt sent to the agent: `/synthesize`,
  `/contradict <topic>`, `/outline`. Pre-fill the box (editable) or send directly, injecting current
  context (open doc / discussed nodes).
- NOT "MCP prompts as commands" — in ACP the agent is the MCP client, so server prompts don't surface
  in our pane. Skip that framing.
- Tests: registry classify (action vs template vs agent-passthrough); local-handle branch; palette
  grouping. Small; renderer-only.

### Track A — Experience / Navigation (independent)
Replace the overlay-panel model (no persistent spatial model, no back/forward) with the navigation the
incumbent apps perfected. **Brainstorm this one before building** — it's a UX redesign, not a feature.
- **A1. Three-pane spine** — source/tree → item list → inspector. The current Canvas/Note/Hub panels
  become *inspector contents* (reuse them; rebuild the shell around them).
- **A2. ⌘K quick-switcher** (fuzzy over the whole index) + **command palette** (surface app actions +
  the Track-0 commands).
- **A3. Appearance polish** (deferred by the user until function is right).

### Track R — The Reader (founding Phase 5; independent; START HERE per recommendation)
Salvage iteration-1 algorithms from git history (`buildPageMap`, `findTocPathsForPages`, lazy
thumbnails) — see `docs/01-prior-iterations-audit.md` §Salvage manifest.

- **R1 — Fix the Canvas (small, high value; do first).** Current heat (`CanvasView.tsx` +
  `pdf/heat.ts`, driven by `queries.pageAnnotations` COUNTS) saturates (3 fixed tiers) and ignores
  annotation TEXT.
  - **Relative/continuous heat**: normalize density against the document's page-max (or a percentile),
    continuous opacity — shows where attention concentrated in THIS book, not an absolute count that
    flatlines at 4+.
  - **Depth layer**: weight by annotation substance — highlighted-text length and especially whether
    the annotation carries a note/comment (comment > bare highlight; maps to the pedagogy spec's
    levels-of-processing). Two toggleable layers: breadth (count) vs depth (substance). Needs the
    annotation TEXT/comment + type in the query (extend `pageAnnotations` or add a sibling).
  - **Zoom**: grid cell-size control (see whole book small ↔ fewer larger pages); lightbox zoom in/out
    + fit-width/fit-page (the fixed 720px is why single-page feels too large).
  - Renderer-mostly + a query extension; TDD the heat-normalization + depth-weighting as pure fns.
- **R2 — Continuous scroll reader (→ feeds Track L).** Stacked pages, pdf.js **text layer** (selection
  + in-document search), and **reading-state**: dwell-time per page + scrolled-through → a persisted
  *exposure* heat layer. Honest framing: measures ENGAGEMENT, not comprehension (don't label it
  "understood"). Reading-state is a first-party artifact keyed by content-hash + page. **Decide its
  shape to feed a forgetting curve** (per-page dwell + timestamps + a `finished` marker), per the
  learner spec's upstream note.
- **R3 — Structure + Views.** TOC/outline sidebar (pdf.js `getOutline` + the salvaged path algorithms);
  the "Views" saved page-range subsets (iteration-1 crown jewel — greys out non-member pages);
  two-page spread; thumbnail-strip + reading-pane; focus/immersive mode. Heat layers render across ALL
  modes (grid tint + scroll minimap).

### Track O — OCR / Scanned-document extraction (→ prerequisite for Track B on scans)
Make picture-scan PDFs first-class, extracted ONCE, stored durably (extract-once / query-forever). A
**confidence-gated cascade**, not one tool:
- **O1**: reuse any existing hidden text layer (free, via pdf.js); else run a MODERN local OCR
  (PaddleOCR / Surya / docTR — NOT Tesseract) on-device. Benchmark on the user's real scans; keep the
  engine swappable behind an interface.
- **O2**: cheap **text-only** LLM correction (BYOK) — fix OCR typos from the text alone (no image →
  orders of magnitude cheaper than vision).
- **O3**: **confidence-gated escalation** — OCR engines emit per-line confidence; send ONLY
  low-confidence pages to a cloud OCR API (Google Vision / Textract, sub-cent/page) or a cheap vision
  model. ~90% resolve free/local; pay only for the hard tail.
- **O4**: **durable cache + integrations** — persist per-page text (+ bounding boxes) keyed by content
  hash in `.astrolabe/ocr/` (a Rebuild NEVER re-OCRs; same scan in Eagle+Zotero OCR'd once). Render OCR
  as a selectable, positioned text layer over the scan in the Reader (**in-view OCR**). Optional:
  vision-describe figures ONCE, store as derived text linked to the page region. OCR text feeds FTS
  now → embeddings/graph later. Local-first default; cloud/vision tiers opt-in BYOK (D5).
- Note: unlike normal derived data, OCR is expensive → cache is durable (recomputed only if missing),
  NOT wiped by `wipeDerived`.

### Track B — The Mind (the graph; founding v1-essential D4)
Detail: `docs/2026-07-10-intelligence-layer-roadmap.md` (Layers 1–2). The wiki-link `links` table is
already the HUMAN edge layer; this adds the machine layer + concepts.
- **B1. Embeddings + semantic search** (sqlite-vec) — meaning-based "near this" edges Obsidian can't
  make; NO extraction pipeline needed. The cheapest first taste of the differentiated graph; joins FTS
  in the lens and enriches the agent's retrieval. (Embed OCR text too, once Track O exists.)
- **B2. Graphify connector** — mirror `graph.json` into an origin-tagged edge substrate
  (`wiki-link`/`extracted`/`inferred`/`asserted`/`proposed`), anchored to documents by path +
  content-hash. Same mirror-table pattern as virtual collections.
- **B3. Graph lens + curation** — Sigma.js navigator + ego-network in the hub + confirm/reject/merge
  (user assertions outrank inference).
- **B4. Extraction pipeline** ("Orion", `docs/09-orion-research.md`) — concepts/claims/entities as
  nodes; cheap-model passes, batched/resumable/cost-visible, BYOK.

### Track L — The Learner Model (Layer 5; fully spec'd; gated on R2 + B)
Complete spec: `docs/2026-07-12-learner-model-pedagogy-spec.md`. Core reframe: the loss function is the
user's KNOWLEDGE STATE; cognitive OFFLOADING is the central design problem (decide per concept when to
remember FOR the user vs make the user remember). Phases: L1 passive knowledge-state mirror → L2 the
metacognitive mirror (fluency-vs-retrieval gap; highest leverage) → L3 retrieval + spacing on
user-flagged internalize nodes → L4 full adaptive loop → L5 reflexive grounding (ingest the pedagogy
corpus). Prerequisites: reading-state (R2), typed graph edges (B), activity stamping.

### Track C — Commercialization (last)
`alidade` licensing backend (founding Phase 6). Open: one-time vs subscription pricing. Signing/
notarization, electron-updater + R2, website. See `docs/05-licensing-and-commercialization.md`.

## 7. Recommended starting point

**Track R1** — it fixes concrete Canvas complaints (heat saturation, static/oversized pages, no zoom,
no annotation-text weighting), is small and renderer-mostly, and lays the heat/zoom/reading-state
groundwork the rest of the Reader and the learner model build on. Then the standing fork: **Track A**
(daily-driver feel) vs **Track O→B** (make scanned material real, then build the mind). Spec each track
before building; dispatch Opus subagents against frozen contracts for the token-heavy phases.

## 8. Doc index

- `docs/00-vision.md`, `02-design-decisions.md`, `01-prior-iterations-audit.md` (+ salvage manifest),
  `03-architecture.md`, `04-tech-stack.md`, `05-licensing`, `08-alioth-intelligence.md`,
  `09-orion-research.md`, `10-engineering-principles.md`, `adr/0001–0007`.
- Roadmaps: `06-roadmap.md` (as-built + 7 tracks), `2026-07-10-intelligence-layer-roadmap.md`.
- Feature specs: `2026-07-10-*` (library navigator, boolean filtering, saved views, virtual
  collections, presence facet, canvas view, notes-hub-ink plan, zotero-write-path),
  `2026-07-11-*` (eagle-zotero-sync, acp-dialogue, acp-rich-client), `2026-07-12-learner-model-pedagogy`.
- This handoff: `2026-07-13-remaining-work-spec.md`.
