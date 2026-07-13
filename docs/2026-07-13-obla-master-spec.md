# O·B·L·A Master Spec — OCR, the Mind, the Learner, the Experience

**Date:** 2026-07-13 · **Status:** build-governing spec for the four remaining tracks
**Scope:** Track O (OCR), Track B (graph), Track L (learner model), Track A (navigation).
Track 0 (command palette) and Track C (commercialization) are explicitly parked per Ahmed.
**Supersedes nothing** — deepens `06-roadmap.md` §Tracks O/B/L/A into execution detail;
`2026-07-10-intelligence-layer-roadmap.md` (Layers 1–5) and
`2026-07-12-learner-model-pedagogy-spec.md` remain the design authorities they were.

## 0. Ground rules (carried forward, non-negotiable)

- Owns no content; every byte derived + rebuildable (ADR-0005) — **except durable caches for
  expensive derivations** (OCR text, embeddings): recomputed only when missing, never wiped
  by `wipeDerived`. The cache is still derived — a fresh machine can rebuild it — it is just
  not *free* to rebuild, so it is keyed by content hash and kept.
- Content-hash identity everywhere: OCR, embeddings, knowledge-state all key by `contentSha256`.
- BYOK / subscriptions, no inference reselling (D5). Local-first; every cloud tier opt-in.
- Provenance mandatory: nothing enters the graph or the overlay without a source anchor.
- Phase-ends-usable (ADR-0007): every numbered phase below ships something personally usable.
- Build loop: spec → TDD (stakes × logic) → gates → commit → dev-install. Opus subagents on
  disjoint file sets against the frozen contracts in this doc; integrator in the main loop.

## Dependency map

```
O1+O4a (local OCR + cache) ──→ feeds FTS now
        └──────────────→ B1 (embeddings need text for scans)
B1 (embeddings) → B2 (graphify substrate) → B3 (graph lens + curation) ⇢ B4 (Orion; parked)
R2 reading-state ✅ ┐
B2/B3 typed graph ──┴→ L1 (overlay) → L2 (mirror) → L3 (retrieval+spacing) → L4 → L5
A — independent; gated on a brainstorm session with Ahmed (UX taste required), not on code.
O2/O3 (correction/escalation) — on-demand once O1 quality on real scans is known.
```

**Recommended order:** O1+O4 → B1 → B2 → B3 → L1 → L2 → (A brainstorm whenever) → L3+ → O2/O3 as
the benchmark demands.

---

# Track O — OCR / scanned-document extraction

**Goal:** picture-scan PDFs become first-class citizens of search, the Reader, and (later) the
graph. Extract once, store durably, query forever. A **confidence-gated cascade**, not one tool.

## O1 — Detection + local OCR

- **Text-layer detection:** during sync (or first open), sample N pages via pdf.js
  `getTextContent` in a main-side worker; a page with meaningful text (≥ ~40 chars of
  non-whitespace) is `native`; a document whose sampled pages are all empty is `scan` →
  OCR queue. Persist per-document status.
- **Rasterization (main-side):** `ELECTRON_RUN_AS_NODE` worker + pdfjs legacy + `@napi-rs/canvas`
  (already shipped in the asar-unpack set) renders page PNGs at ~2× (≈300 DPI for letter).
  Never in the renderer — OCR must run with the app closed to that document.
- **Engine interface (FROZEN):**
  ```ts
  interface OcrEngine {
    id: string                                  // 'apple-vision' | 'rapidocr' | 'gcv' | …
    kind: 'local' | 'cloud'
    available(): Promise<boolean>
    recognizePage(png: Buffer): Promise<OcrPageResult>
  }
  interface OcrLine { text: string; confidence: number /* 0..1 */; bbox: [x0,y0,x1,y1] /* fractions of page */ }
  interface OcrPageResult { lines: OcrLine[]; text: string; meanConfidence: number }
  ```
- **Engine candidates, benchmarked on Ahmed's real scans before committing** (keep both behind
  the interface; the benchmark is a script, not a UI):
  1. **Apple Vision** (`VNRecognizeTextRequest`) via a tiny Swift helper binary built alongside
     the app (macOS-native, on-device, zero model download, quality near cloud tier). Primary
     candidate — the app is macOS-first and already ships a signing pipeline for helpers.
  2. **RapidOCR (PaddleOCR models on onnxruntime-node)** — cross-platform fallback, no Python.
  - NOT Tesseract (quality floor too low on books), NOT Surya (Python runtime dependency).
- **Job engine:** deterministic, batched, resumable, cost-visible (Orion design laws applied
  early): per-document job = pages → raster → recognize → cache write, checkpointed per page;
  survives app restart; concurrency-capped; progress + per-tier page counts surfaced.

## O2 — Text-only LLM correction (BYOK, opt-in)

- Cheap text model fixes OCR errors from text alone (no image → orders of magnitude cheaper
  than vision). Chunked pages, deterministic prompt ("correct recognition errors; never
  paraphrase; preserve line breaks"), diff-gated (reject corrections that change >15% of
  characters — hallucination guard).
- Corrected text stored **alongside** raw (`text` vs `rawText`), provenance-flagged
  (`correctedBy: <model>`); FTS uses corrected when present.
- BYOK keys via Electron `safeStorage`, a `.astrolabe/keys` blob — the app's first stored key;
  design it once, reuse for B1 embeddings.

## O3 — Confidence-gated escalation (opt-in)

- Pages with `meanConfidence < threshold` (default 0.85, tunable) queue for an escalation tier:
  a cloud OCR API (Google Vision / Textract, sub-cent/page) or a cheap vision model — one more
  `OcrEngine` implementation each. Expectation: ~90% of pages resolve free/local; only the hard
  tail costs money. Escalation results overwrite the low-confidence page entry with
  `engine: <cloud-id>` provenance. Default **off**; per-run cost estimate shown before start.

## O4 — Durable cache + integrations (build WITH O1, not after)

- **Cache (FROZEN):** `.astrolabe/ocr/<contentSha256>.json`
  ```ts
  { schemaVersion: 1, contentSha256, engine: string, createdAt: ISO, updatedAt: ISO,
    pages: Record<string /*pageIndex*/, {
      status: 'done' | 'low-confidence' | 'failed',
      text: string, rawText?: string, correctedBy?: string, escalatedTo?: string,
      meanConfidence: number, lines: OcrLine[] }> }
  ```
  Same artifact discipline as reading-state/page-views (zod, schemaVersion, atomic write,
  hash-keyed → the same scan in Eagle+Zotero is OCR'd once; rebuild never re-OCRs).
- **Index integration:** cached page text ingests into a `page_text` FTS table during sync
  (derived, rebuildable *from the cache*). Search hits on scanned books deep-link to the page.
- **Reader in-view OCR:** for `scan` documents, `getPageText` consults the OCR cache (find/
  highlighting then work unchanged), and the page cell renders a **selectable text overlay**
  built from `lines[].bbox` using the existing `.textLayer` CSS conventions — selection and
  find-highlighting over scans, same UX as native PDFs.
- **Optional:** vision-describe figures ONCE per region, stored as derived text linked to the
  page region (feeds search + embeddings for image-heavy sources). Opt-in with O3.
- **IPC (FROZEN):** `ocr:status {documentId} → OcrStatus` · `ocr:run {documentId} | {all:true}`
  · `ocr:cancel {documentId}` · `ocr:get {documentId} → cached pages (text+lines)`; progress
  pushed over the existing sync-status event pattern. Preload namespace `window.astrolabe.ocr`.

**Tests:** engine interface conformance (fixture PNGs); detection sampling; job resume after
kill (itest); cache round-trip/corrupt/hash-shared (itest, page-views precedent); diff-gate
rejection (unit); Reader overlay geometry (component, jsdom-guarded).
**Usable at end of O1+O4:** scanned books are searchable and selectable in the Reader.

---

# Track B — The Mind (graph; founding D4)

Design authority: `2026-07-10-intelligence-layer-roadmap.md` Layers 1–2. This section adds the
execution contracts. Cardinal law: **one edges substrate**, origin-tagged —
`wiki-link` (human) · `extracted`/`inferred` (graphify) · `asserted` (user) · `proposed` (agent).

## B1 — Embeddings + semantic search (the cheapest first taste)

- **sqlite-vec** loaded into the existing better-sqlite3 index db (verify extension load under
  Electron's node ABI in an itest FIRST — the one real risk; fallback: brute-force cosine over
  a BLOB column, acceptable to ~100k chunks).
- **Chunking:** notes → whole-note + per-heading-section; PDFs → per page (native text or OCR
  cache); annotations → highlight+comment pairs. Chunk record keys:
  `(documentId, kind, ordinal, chunkSha)`.
- **Provider interface (FROZEN):**
  ```ts
  interface EmbeddingProvider { id: string; dim: number; embed(texts: string[]): Promise<Float32Array[]> }
  ```
  First provider: an OpenAI-compatible endpoint (BYOK via the O2 key store; model configurable,
  default `text-embedding-3-small`). Local providers can land later behind the same interface.
- **Durable cache:** `.astrolabe/cache/embeddings/<model>/<chunkSha>.bin` — re-embedding on
  rebuild is a cache read; only NEW chunks cost money. Batched, resumable, cost-visible
  (estimate shown before the first full run).
- **Hybrid search:** `searchRequestSchema` gains `mode: 'keyword' | 'semantic' | 'hybrid'`
  (default keyword — zero behavior change). Hybrid = reciprocal-rank fusion of FTS and vector
  top-k. New MCP tool `semantic_search` (the agent's retrieval upgrade). Lens: a search-mode
  toggle beside the existing input; semantic hits show their similarity source snippet.
- **"Near this" edges:** nearest-neighbor pairs above a similarity floor materialize as
  `origin: 'inferred', relation: 'similar-to'` edges (B2's table), recomputed per sync.

## B2 — Graphify connector (the machine edge layer)

- **Mirror-table pattern** (virtual-collections precedent): watch `graph.json` outputs declared
  in the workspace manifest (`connectors.graphify.outputs: string[]`); mirror into:
  ```sql
  graph_nodes(id, key, label, kind, summary, sourcePath, contentSha, meta_json)
  graph_edges(id, srcNodeId, dstNodeId, relation, origin, confidence, provenance_json, meta_json)
  -- origin: 'wiki-link'|'extracted'|'inferred'|'asserted'|'proposed'
  -- relation: REQUIRED typed label ('supports'|'contradicts'|'prerequisite-of'|'instance-of'|
  --           'similar-to'|…free-form allowed) — learner spec upstream decision #2 enforced here.
  ```
- Wiki-links **re-expressed** into the same substrate at sync (origin `wiki-link`) so every
  consumer queries one table; provenance anchors resolve by path + content hash + optional
  page/TOC-path (the R3 `/0/2/1` path strings become real anchors here).
- **Curation overlay** (`graph_curation(nodeOrEdgeKey, verdict, mergedInto, at)`) survives
  re-mirroring: confirmed/rejected/merged verdicts and `asserted` edges are user data —
  first-party artifact `.astrolabe/graph-curation.json`, mirrored to a table (saved-views
  precedent). **User assertions permanently outrank extractions.**
- Astrolabe builds NO extraction pipeline here — `/graphify` runs externally over vault
  subtrees / OCR'd book text; Astrolabe mirrors the output (intelligence roadmap Layer 1).

## B3 — Graph lens + curation UI

- **Graph navigator panel** (Sigma.js): filter by origin/source/recency/relation; node click →
  provenance panel → deep link to the exact page (Reader), note (NoteView), or drawing.
- **Ego network in the Document Hub:** this document's concepts, their 1-hop neighbors, the
  notes between them (hub gains a "Mind" section).
- **Curation verbs** on machine nodes/edges: confirm / reject / merge (+ draw manual edge =
  `asserted`). Rejected content hides everywhere; merges unify provenance.
- MCP tools: `graph_neighborhood`, `graph_path`, `get_concept` (+ `propose_edge` as the
  agent-write ceiling, `origin: 'proposed'`, gated by the existing permission cards).

## B4 — Orion (parked, by design)

`docs/09-orion-research.md` stands as the design. Explicitly NOT built while graphify serves
(intelligence roadmap §"Explicitly out"). If/when revisited it lands as another producer of the
same substrate. No further spec here on purpose.

**Tests:** vec-extension load itest (first!); chunker (unit, heavy); RRF fusion (unit); embed
cache hit/miss (itest); mirror idempotency + curation survival across re-mirror (itest); graph
queries (itest); navigator/hub/curation components.
**Usable at end of B1:** "find things that MEAN this" across the whole library incl. scans.
**Usable at end of B3:** wander the second brain, land on sources — zero tokens.

---

# Track L — The Learner Model (Layer 5)

Design authority: `2026-07-12-learner-model-pedagogy-spec.md` (thesis: the loss function is the
user's knowledge state; the central design problem is cognitive offloading — per concept, decide
remember-FOR-the-user vs make-the-user-remember). This section is the execution bridge.
**Gates:** L1 needs B2/B3 (typed graph + a surface to paint on). Reading-state ✅ (R2, already
accruing). Dialogue `documentIds` ✅. Annotations ✅.

## L0 — Activity stamping (do during B2/B3, near-free)

Learner-spec upstream decision #3: when a dialogue or annotation touches a graph node, stamp it.
Concretely: dialogue persistence already stores `documentIds`; extend the B2 substrate join so
`discussed`/`annotated` evidence is a QUERY, not new bookkeeping. Verify while building B3.

## L1 — Passive knowledge-state overlay (the mirror)

- **Derived table** (rebuildable from graph + activity sources; never a system of record):
  ```sql
  knowledge_state(nodeId, readScore, annotatedScore, writtenScore, discussedScore,
                  recalledScore, mastery, lastEvidenceAt, decayedMastery)
  ```
  computed by pure, TDD'd evidence folds over: reading-state artifacts (dwell/finished per
  page → via provenance anchors to nodes), annotations (existing tables), wiki-links from the
  user's own notes, dialogue links. `decayedMastery` = mastery × a forgetting-curve factor from
  `lastEvidenceAt` (half-life per evidence type; constants are policy, tests pin orderings).
- **Surface:** knowledge heat over the B3 graph navigator (the R1 heat idiom, reused); a
  "knowledge" strip in the Document Hub. Honest labels: *engaged/exposed*, never "known".
- **Usable alone:** "here's what you've actually engaged vs merely stored."

## L2 — The metacognitive mirror (highest leverage, read-mostly)

High-centrality nodes where fluency proxies are high (re-read often, recently, heavily
highlighted) but retrieval evidence is absent → surfaced as a gentle "you've *seen* this a lot;
could you reproduce it?" panel. Pure query over L1 + graph centrality. No prompting loop yet.

## L3 — Retrieval + spacing on user-flagged nodes (the loop begins)

- **Goals artifact (FROZEN):** `.astrolabe/goals/<slug>.json` —
  `{ schemaVersion: 1, name, nodeKeys: string[], flags: Record<nodeKey,'internalize'|'reference'>, deadline?: ISO, createdAt }`
  (user-owned, like saved views; the ONLY non-rebuildable L artifact).
- **Spacing scheduler:** pure function (TDD hard) — SM-2-family intervals over recall grades,
  per node; due-queue derived, never stored authority.
- **Tutor = the existing ACP agent + a tutor system prompt + MCP** (no new agent): reads
  overlay/graph/due-queue via MCP; asks source-grounded questions WITH jump-to-page citations;
  a gated `record_recall` MCP write tool logs graded evidence to `.astrolabe/sessions/`.
  Offloading policy honored: `reference`-flagged nodes are never drilled — the system remembers
  those FOR the user.
- L4 (full adaptive loop: interleaving/elaboration/transfer + measure→update) and L5 (ingest
  the pedagogy corpus so the tutor's own moves are graph-grounded) follow the pedagogy spec
  §9 as written; contracts defined when L3 evidence exists to design against.

**Tests:** evidence folds and decay (unit, orderings not constants); scheduler (unit, heavy);
overlay rebuild determinism (itest); goals artifact (itest, views precedent); record_recall
gating (itest); mirror/overlay components.

---

# Track A — Experience / Navigation (proposal — brainstorm-gated)

**This track does not start from this spec alone.** It is a UX redesign; Ahmed's taste is the
requirement (his standing instruction). This section is the concrete PROPOSAL to react to in a
brainstorm session, so that session starts from something.

## A1 — Three-pane spine (the incumbent-app grammar)

`nav rail | item list | inspector` replacing the overlay-panel model:
- **Left:** the existing NavRail (sources/collections/tags/presence/views) — persistent.
- **Center:** river or search results (existing components) — persistent.
- **Right (inspector):** the current panels become inspector CONTENT — Hub is the default
  inspector for a selected document; Canvas/Reader/Note open *within* the inspector region,
  expandable to full-window (Reader focus mode already is that). Reuse, don't rebuild.
- **History:** a back/forward stack over (selection, inspector-mode) — the missing spatial
  memory. Keyboard: ⌘[ / ⌘].
- Panel-state architecture from the R3c Views lift (Lens-owned maps keyed by documentId)
  already points the way; this generalizes it into a small navigation store.

## A2 — ⌘K quick-switcher

Fuzzy over titles/tags/collections/saved-views (a lightweight `index:quick` channel — prefix +
trigram over the existing tables; NOT full FTS), ranked by recency of interaction (reading-state
gives this for free). Enter opens in the inspector; ⌘Enter opens the Reader directly. (App
*actions* in the same palette = Track 0 territory — parked with it.)

## A3 — Appearance polish

Deferred until A1/A2 function is approved (Ahmed's explicit ordering).

**Decision points for the brainstorm** (each changes the build): inspector vs overlay for the
Reader day-to-day; does the dialogue pane stay a left column or dock into the spine; center list
density (river cards vs compact rows); what ⌘K should rank first; keyboard map.

---

# Execution notes (all tracks)

- **Per-phase pattern proven in Track R:** spec section → frozen contract → parallel Opus
  subagents on disjoint file sets (main/seam vs renderer) → sequential wave for shared files →
  integrator re-verifies every agent claim → full gates → commit → dev-install.
- **Artifact-store twins:** OCR cache, embeddings cache, goals, graph-curation all follow the
  reading-state/page-views implementation (zod + schemaVersion + atomic write + hash keys) —
  each is a one-agent task with the existing files as the template.
- **Key store (O2) is shared infrastructure** — build it once in Track O, reuse in B1.
- **First spikes** (kill risks before they're load-bearing): sqlite-vec under Electron ABI
  (B1); Apple Vision helper end-to-end on one real scan (O1); Sigma.js in the renderer
  bundle (B3).
