# 00 — Vision

**Status:** Current — founding design session · **Date:** 2026-07-07

## What Astrolabe is

Astrolabe is a local-first knowledge environment built for **intelligence augmentation**: a second
brain that can fly like an aircraft through the space of deep thought, research, and art, with the
user at the helm of their own assets and knowledge.

It is conceived as a fusion of four tools, taking from each the thing it does best:

- **Notion** — structured, stateful document workspaces and a unified surface
- **Eagle.cool** — frictionless local asset management with no boilerplate file handling
- **Zotero** — bibliographic rigor: sources, citations, PDF annotations as first-class data
- **Obsidian** — plain-text knowledge, wiki-linking, and a graph of ideas in open formats

The founding principles, in the user's own words:

1. **No boilerplate file management** — the user should never fight a file dialog or folder tree to
   capture or find something
2. **Open standards and file formats** — everything durable lives in formats other tools can read
3. **Local storage** — the user's library lives on the user's machine
4. **Performant document navigation**, especially of PDFs
5. **Extraction of information** from documents
6. **Tracking of reading progress**
7. **Connecting materials to information and insights**
8. **Artificial intelligence** that processes documents, builds knowledge graphs, and informs future
   outputs

## The founding reframe: orchestrator, not fifth app

The decisive insight of the founding design session: **Astrolabe is not a fifth application competing
with the four it fuses — it is the intelligence and navigation layer over the tools the user already
trusts.**

- Zotero keeps citations, papers, and PDF annotations. It remains the system of record for sources.
- Obsidian's vault keeps typed notes as plain Markdown. It remains the system of record for notes.
- Eagle keeps visual assets. It remains the system of record for images and media.
- The iPad and paper keep producing handwritten ink, which Astrolabe ingests, OCRs, and links.

Astrolabe's job is the one thing none of them does: maintain a **living knowledge graph** built by AI
from all of that content, and give the user **one surface** to navigate it — ask a question, get an
answer grounded in the user's own library, and jump to the exact page, note, or asset that supports
it.

This reframe deletes the failure mode of every previous iteration (see
[01 — Prior Iterations Audit](01-prior-iterations-audit.md)): the previous attempts died building
file management. In this architecture, **Eagle and Zotero ARE the file manager.** Astrolabe builds
only the layer that exists nowhere else: the graph, the agent, and the unified navigation.

It also solves the open-formats principle for free: the on-disk truth is Zotero's database, Obsidian's
Markdown vault, and Eagle's library — all already open, all still fully usable if Astrolabe is deleted.

## The inviolable principle

> **Astrolabe owns no content — only connections, intelligence, and dialogue.**

Every byte in Astrolabe's index is derived from the systems of record and can be rebuilt from them at
any time. Astrolabe's only first-party artifacts are:

- **Dialogues** — conversations with Alioth, persisted as open-format files
- **Saved views** — named lenses over the graph and library
- **Graph annotations** — user-added edges, notes, and corrections to the graph

These live as JSON/Markdown in a versioned `.astrolabe/` workspace directory — also open, also
portable, also syncable by any file-sync mechanism the user already runs.

## Alioth: the purpose-built agent harness

The user's formulation, which defines the product: *"I am building my own agent harness and an
interface for it that is purpose-built to orchestrate knowledge. One logs into Astrolabe, uses the
Alioth intelligence agent, plugs into these other services using their APIs, and — in one place,
without burning tokens on some CLI interface re-prompting MCP servers — can use their own brain to
navigate the space of all the information and assets they have."*

Three properties make a purpose-built harness categorically different from pointing a generic agent
(Claude Code, a chatbot with MCP servers) at the same data:

1. **Deterministic connectors, not agent tool-calls.** Sync and ingestion — reading Zotero's
   database, watching the Obsidian vault, pulling Eagle metadata, OCR'ing ink — are ordinary code
   running on schedules and file-watchers. Zero tokens. A generic harness burns tokens having the
   model *discover* the library through tool calls every session; Alioth never does, because the
   library is already indexed before the agent wakes up.

2. **The graph is pre-built context.** When the user asks Alioth something, it does not spelunk
   through MCP servers re-reading PDFs — it queries the persistent graph and embedding index and
   receives exactly the relevant subgraph as context. The expensive extraction happened once, at
   ingestion. Build the mind once, query it forever.

3. **The user's brain navigates for free; the agent is summoned deliberately.** Most navigation —
   browsing the graph, jumping to a Zotero page, filtering by concept, following backlinks — is
   direct UI manipulation costing nothing. Alioth is invoked when the user wants synthesis,
   extraction, or connection-finding. The interface is the primary instrument; the agent is the
   collaborator inside it. That is intelligence augmentation rather than chatbot-with-tools.

## Naming

All three names are components of the same navigational tradition:

- **Astrolabe** — the instrument itself: the application, the interface
- **Alioth** — the brightest star in Ursa Major, used for celestial navigation: the intelligence
  agent / harness inside the app
- **Alidade** — the sighting arm of an astrolabe: the small backend that "sights" licenses and
  updates (see [05 — Licensing & Commercialization](05-licensing-and-commercialization.md))

## Who it is for

People who already live in some combination of Zotero, Obsidian, and Eagle — researchers, graduate
students, writers, self-directed learners — a passionate, paying, reachable market that is
chronically underserved on integration. The builder is the archetypal user, which is the correct
starting position for a product of this kind.
