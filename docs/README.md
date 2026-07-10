# Astrolabe Documentation

This documentation set was produced from the founding design session (2026-07-07), which included a
four-repository audit of all prior Astrolabe iterations and a full brainstorming pass over the product
concept, architecture, tech stack, and commercialization model.

Read in order for the full picture; each document also stands alone.

| # | Document | What it contains |
|---|----------|------------------|
| 00 | [Vision](00-vision.md) | What Astrolabe is, the core principle, naming, and the reframe from "fifth app" to orchestrator |
| 01 | [Prior Iterations Audit](01-prior-iterations-audit.md) | Full findings from the four previous codebases: what was built, what to salvage, what killed them |
| 02 | [Design Decisions](02-design-decisions.md) | Every decision made in the founding session, with the alternatives considered and rationale |
| 03 | [Architecture](03-architecture.md) | The six-layer architecture: interface, Alioth harness, index, Orion engine, connectors, systems of record |
| 04 | [Tech Stack](04-tech-stack.md) | Frontend and backend stacks with rationale, rejected alternatives, and industry comparisons |
| 05 | [Licensing & Commercialization](05-licensing-and-commercialization.md) | The Eagle-model license, Ed25519 mechanics, device limits, anti-piracy stance, pricing, alidade scope |
| 06 | [Roadmap](06-roadmap.md) | Phased build order, each phase ending in something personally usable |
| 07 | [Development Setup](07-development-setup.md) | WebStorm setup, scaffold plan, repo conventions, what to port from the old repos |
| 08 | [Alioth Intelligence](08-alioth-intelligence.md) | The agent harness in depth: the harness contract, provider layer, context assembler, skills, dialogues, and what Alioth never does |
| 09 | [Orion Research](09-orion-research.md) | The knowledge engine in depth: the six-stage pipeline, design laws, where insight comes from, and the connector/Orion/Alioth boundary |
| 10 | [Engineering Principles](10-engineering-principles.md) | How we work: the 13 operating principles (TDD altitude, fail-closed, build-on-consumption, disposability, mechanical-vs-cultural enforcement …), each traced to an audit lesson and citing its ADR |

## Architecture Decision Records

Irreversible choices live as numbered ADRs in [`adr/`](adr/) — one decision per file, each recording
its rejected alternatives so it is never relitigated (the failure mode of iterations 1–4). The
founding set:

| ADR | Decision |
|---|---|
| [0001](adr/0001-orchestrator-owns-no-content.md) | Astrolabe is an orchestrator and owns no content |
| [0002](adr/0002-electron-desktop-shell.md) | Electron is the desktop shell — final |
| [0003](adr/0003-two-repositories.md) | Two separate repos; `alidade` created only at commercialization |
| [0004](adr/0004-byok-and-local-ai.md) | AI is BYOK cloud + optional local; sell the license, not tokens |
| [0005](adr/0005-derived-rebuildable-index.md) | The index is derived and rebuildable — architectural law |
| [0006](adr/0006-test-altitude.md) | Test altitude — TDD rigor scales to stakes × logic |
| [0007](adr/0007-phase-ends-usable.md) | Every roadmap phase ends with something personally usable |

New irreversible decisions add an ADR (copy [`adr/template.md`](adr/template.md)); changing a
boundary updates its ADR in the same commit — law and enforcement never drift apart.

## Specs

Living project-level specs sit at the repo root (like this project's ADRs, they are durable, not
dated point-in-time working documents):

- [`INFRASTRUCTURE-SPEC.md`](../INFRASTRUCTURE-SPEC.md) — the build plan for the next infrastructure
  phases: testing, logging, and the local database (the how behind roadmap Phases 0–1).
- [`COMMERCIALIZATION-SPEC.md`](../COMMERCIALIZATION-SPEC.md) — the build plan behind doc 05:
  Ed25519 licensing, alidade's endpoints, anti-piracy layers, and the build-vs-buy decision (Phase 6).
- [`ALIDADE-SPEC.md`](../ALIDADE-SPEC.md) — the alidade repository blueprint: bootstrap sequence,
  modular-monolith architecture, packages, Supabase decision, and growth path (moves to the alidade
  repo as its founding doc on creation day).

Dated point-in-time implementation specs live in `docs/specs/YYYY-MM-DD-slug.md`
(dev-setup convention §9):

- [`specs/2026-07-09-runway-to-library-lens.md`](specs/2026-07-09-runway-to-library-lens.md) — the
  step-by-step build plan from the test-harness commit through Pino, SQLite/IPC, index schema,
  Zotero + Eagle connectors, Library Lens v0, and the Phase 1.5 interim MCP server; includes the
  live-verified API ground truth.

## The one-sentence definition

> Astrolabe is a desktop application in which Alioth, a purpose-built knowledge agent, and the user
> together build and navigate a living knowledge graph over the user's existing systems of record —
> Zotero, Obsidian, Eagle, and handwritten-note ingestion — which remain the untouched, open-format
> owners of all content.

## The inviolable principle

**Astrolabe owns no content — only connections, intelligence, and dialogue.** Its entire index is
derived and rebuildable. Deleting Astrolabe loses nothing but the intelligence layer. This is
simultaneously the open-standards story, the privacy story, and the structural guarantee that this
iteration cannot die the way the previous four did — there is no file management left to build.
