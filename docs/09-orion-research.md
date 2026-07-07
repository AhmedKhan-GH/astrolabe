# 09 — Orion Research

**Status:** Current — founding design session · **Date:** 2026-07-07

Orion is the knowledge engine — the programmatic subsystem that **builds and maintains the
knowledge network** the agent navigates. Its counterpart is
[08 — Alioth Intelligence](08-alioth-intelligence.md), the agent harness. The division of labor in
one line:

> **Orion builds the mind; Alioth navigates it.**

Where Alioth is summoned, Orion just runs. It has no dialogue surface, no personality, and no
autonomy in the agentic sense: it is deterministic orchestration wrapped around batched model
passes, triggered by ingestion events, always resumable, always cost-visible. It is the
"build the mind once" half of the founding economics.

## Naming

Orion is the most recognizable constellation in the sky, and its belt is the classic pointer
asterism — navigators have always used it to find everything else. It joins the tradition:
Astrolabe (the instrument), Alioth (the star one steers by), alidade (the sighting arm), Orion
(the constellation that charts the sky the others navigate).

## Position in the architecture

Layer 3 of six (see [03 — Architecture](03-architecture.md)): above the connectors, below the
index. Connectors deliver raw content and change events; Orion transforms them into the network —
nodes, edges, embeddings, provenance — and writes the result into the index; Alioth reads it. Orion
lives in the Electron main process alongside both.

## The pipeline

Six stages, run incrementally on new or changed content:

1. **Change detection** — consumes connector events (Zotero modification timestamps, vault
   file-watcher events, Eagle item changes, ink inbox arrivals) and computes the work list. Pure
   code, zero tokens.
2. **Text acquisition** — PDF text extraction (pdf.js in a worker/utility process), Markdown and
   frontmatter parsing, annotation harvesting, OCR sidecars for ink. Feeds FTS5 directly.
3. **Extraction passes** — the token-spending core, using the two-layer pattern proven by the
   graphify/business-mind builds: **cheap-model reading passes** propose concepts, claims, and
   entities with candidate edges and provenance anchors; **stronger-model synthesis passes**
   consolidate, deduplicate, and rank. Batched, resumable, progress- and cost-visible.
4. **Embedding** — vectors into sqlite-vec, joining FTS5 for hybrid retrieval.
5. **Graph integration** — entity resolution and merge against the existing graph, typed directed
   edges with confidence and origin (`extracted` vs `user-asserted`), every node and edge anchored
   to provenance URIs. Nothing enters the graph without a source anchor.
6. **Maintenance** — re-extraction and invalidation when a source changes, reconciliation with
   user curation, and the always-available **full rebuild** (the derived-and-rebuildable law made
   operational).

## Design laws

1. **Derived and rebuildable.** Orion's entire output can be regenerated from the systems of
   record at any time. "Rebuild index" must always exist and always work.
2. **Provenance is mandatory.** No orphan nodes, no unanchored edges. Provenance URIs
   (`zotero://…`, `obsidian://…`, `eagle://…`, plus page/TOC-path anchors) are the join keys
   between the graph and reality.
3. **Batched, resumable, cost-visible.** Extraction over a real library is a long job on the
   user's own API key; it must survive interruption, report progress, and show spend — this is
   what makes users trust the ingestion cost (06, standing risks).
4. **Deterministic orchestration; models only inside passes.** The loop, scheduling, batching, and
   bookkeeping are ordinary code. The model is a function called *by* the pipeline, never an agent
   driving it.
5. **User assertions outrank extractions.** Orion never overwrites curation: confirmed, rejected,
   merged, and hand-drawn edges survive every re-run.
6. **Idempotent.** Re-running Orion over unchanged content is a no-op, not a duplicate graph.

## Where new insight comes from

The graph enables insight precisely because Orion works **across sources** that have never met in
one index before:

- A handwritten ink page and a Zotero paper proposing the same concept become one node with two
  provenance anchors — the connection existed only in the user's head until ingestion
- Embedding neighborhoods surface non-obvious adjacency: a vault note sitting semantically next to
  a paper the user hasn't linked it to becomes a candidate edge
- Candidate edges are exactly what Alioth's `connect` skill and the graph navigator put in front
  of the user — Orion proposes, the user (or a deliberate Alioth invocation) disposes

Orion does not decide what is insightful; it makes the latent structure visible and cheap to
traverse, which is where insight becomes findable.

## Boundaries

| | Connectors | Orion | Alioth |
|---|---|---|---|
| Triggered by | schedules, file-watchers, app events | ingestion events, explicit runs | deliberate user invocation |
| Token cost | zero — pure code | once per document, batched | per invocation, minimized by pre-built context |
| Reads | systems of record | raw content + index | index only (tools as exception) |
| Produces | raw content, metadata, change events | the knowledge network: nodes, edges, embeddings, provenance | answers, syntheses, proposed edges, dialogues |
| Nature | sync code | pipeline engine | agent harness |

## What Orion is not

- **Not an agent** — no tool loop, no dialogue, no goals; a pipeline
- **Not a web crawler** — its scope is the user's own library. Future feed connectors (arXiv,
  browser bookmarks — deferred in 06) would still only *deliver into* Orion, never change its
  nature
- **Not a system of record** — its output is the index, which is derived and disposable by
  architectural law

## Roadmap placement

Phase 2 (weeks 5–9) is Orion's phase: the extraction pipeline, embeddings, graph schema, and the
navigator UI over its output. Phase 4 (ink ingestion) adds a source that feeds it. Phase 3
(Alioth) depends on it — the harness is only as good as the network it navigates.
