# ADR-0005: The index is derived and rebuildable — architectural law

**Status:** Accepted
**Date:** 2026-07-07

## Context

ADR-0001 commits Astrolabe to owning no content. That is a product promise; it needs an engineering
invariant that keeps it structurally true, or it decays the first time a convenient feature quietly
stores something only Astrolabe holds. Iteration 1 demonstrated the decay directly: PDF binaries
lived as Blobs inside IndexedDB and Excalidraw drawings in localStorage — the storage contradicted
the local-first, own-no-content vision, and export/import could OOM or wipe all data.

## Decision

The Astrolabe index — one `better-sqlite3` database (graph tables + FTS5 + sqlite-vec) in
`.astrolabe/index.db` — is **derived and rebuildable. This is architectural law:**

1. Every node, edge, embedding, and extracted-text row is **derived from a system of record** and can
   be regenerated from it.
2. A **"Rebuild index" action must always exist and always work** — and is built in Phase 1, before
   the graph, to prove the law from the start.
3. **No user data may live only in the index.** Astrolabe's own first-party artifacts (dialogues,
   views, graph annotations) are open files in `.astrolabe/`, not index-only rows.
4. **Provenance is mandatory:** every node/edge anchors to a source URI (`zotero://`, `obsidian://`,
   `eagle://`, plus page/TOC-path anchors) — no orphan nodes, no unanchored edges. Provenance URIs
   are the join keys between the graph and reality.

(Architecture doc, Layer 4; Orion Research doc, design laws.)

## Consequences

- The index is disposable: it can be deleted, corrupted, or schema-migrated by full rebuild without
  data loss — this is the entire multi-device story (ADR context / D11): synced sources +
  rebuildable index + file-synced workspace = no sync backend.
- Graph construction (Orion) is idempotent and resumable; re-running over unchanged content is a
  no-op, and user assertions (confirmed/rejected/merged edges) outrank extractions and survive every
  rebuild.
- **Cost:** a rebuild re-spends extraction tokens — mitigated by incremental sync (only changed
  content re-extracts) and batching.
- **Never:** the index as a system of record; a node without provenance; a first-party artifact that
  exists only as index rows.
