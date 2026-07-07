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
| 03 | [Architecture](03-architecture.md) | The five-layer architecture: interface, Alioth harness, index, connectors, systems of record |
| 04 | [Tech Stack](04-tech-stack.md) | Frontend and backend stacks with rationale, rejected alternatives, and industry comparisons |
| 05 | [Licensing & Commercialization](05-licensing-and-commercialization.md) | The Eagle-model license, Ed25519 mechanics, device limits, anti-piracy stance, pricing, alidade scope |
| 06 | [Roadmap](06-roadmap.md) | Phased build order, each phase ending in something personally usable |
| 07 | [Development Setup](07-development-setup.md) | WebStorm setup, scaffold plan, repo conventions, what to port from the old repos |

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
