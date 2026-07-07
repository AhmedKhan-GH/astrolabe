# ADR-0001: Astrolabe is an orchestrator and owns no content

**Status:** Accepted
**Date:** 2026-07-07

## Context

Four prior iterations (`~/Desktop/astrolabe/`, audited 2026-07-07 — see
[01 — Prior Iterations Audit](../01-prior-iterations-audit.md)) all died the same death: each spent
its energy building **file management** — a PDF store in IndexedDB, an Electron file/folder
organizer with 4k lines of tree tests, a scaffold — and none shipped the product value (graph, AI,
synthesis). The 80/20 was inverted every time. Meanwhile the user already runs Zotero (sources),
Obsidian (notes), and Eagle (assets), each of which manages its own files better than a rebuild
would.

## Decision

Astrolabe is the **intelligence-and-navigation layer over the tools the user already trusts**, not a
fifth app that competes with them. The inviolable principle:

> **Astrolabe owns no content — only connections, intelligence, and dialogue.**

Zotero, Obsidian, and Eagle remain the **systems of record**. Astrolabe connects to them, builds a
derived knowledge graph on top, gives one surface to navigate it, and **writes back into each tool in
that tool's own native format**. Its only first-party artifacts are dialogues, saved views, and graph
annotations — open files in the `.astrolabe/` workspace. (Design decision D3; Vision doc.)

## Consequences

- **There is no file management left to build** — Eagle and Zotero *are* the file manager. This
  structurally removes the failure mode of all four prior iterations.
- The open-formats and privacy promises come for free: on-disk truth stays in the tools' own open
  formats; deleting Astrolabe loses only the intelligence layer.
- **Cost:** dependency on three external local APIs (mitigated — connectors are isolated behind
  interfaces; a broken connector dims one source, never the app; ADR-0002 context).
- **Never:** cloud storage of user content in the core product; a native reader/library that
  duplicates what a system of record owns; any write that the owning tool cannot read natively.
- **Rejected:** (B) plugin swarm across three host UIs — can never deliver one continuous flow, three
  products to commercialize; (C) standalone with import — rebuilds the library management this project
  exists to *avoid*. (Design decision D8.)
- Enforced operationally by ADR-0005 (the index is derived and rebuildable — the engineering
  invariant that keeps this decision honest).
