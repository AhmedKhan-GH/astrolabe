# 08 — Alioth Intelligence

**Status:** Current — founding design session · **Date:** 2026-07-07

Alioth is the agent harness — Astrolabe's conversational intelligence, purpose-built to orchestrate
knowledge rather than to be a generic chatbot with tools. Its counterpart is
[09 — Orion Research](09-orion-research.md), the knowledge engine. The division of labor in one
line:

> **Orion builds the mind; Alioth navigates it.**

Orion constructs and maintains the knowledge network programmatically, at ingestion time. Alioth is
the deliberate, dialogic intelligence that traverses that network *with* the user — answering,
synthesizing, connecting, and always citing. Together they are the two halves of "build the mind
once, query it forever" (00 — Vision): Orion is the build-once; Alioth is the query-forever.

## Naming

Alioth (ε Ursae Majoris) is the brightest star in Ursa Major and a standard celestial-navigation
star — the light one steers by, inside the instrument (Astrolabe) whose sighting arm is the
alidade and whose sky is charted by Orion.

## Position in the architecture

Layer 5 of six (see [03 — Architecture](03-architecture.md)): above the index, below the
interface. Alioth lives in the Electron main process; the renderer talks to it over typed IPC. It
**reads** the index that Orion maintains; it never builds the index in bulk, and it never wanders
raw sources by default.

## The harness contract — why purpose-built beats generic

These are the three properties from the founding vision, restated as Alioth's operating contract:

1. **No discovery cost, ever.** Alioth wakes up with the library already indexed. A generic agent
   (Claude Code + MCP servers) burns tokens re-discovering the library through tool calls every
   session; Alioth's substrate is prepared before it is summoned — by connectors and Orion, both
   token-free or paid once at ingestion.
2. **Context is assembled, not explored.** Alioth is handed the relevant subgraph, excerpts, and
   provenance as a pre-built prompt. Tool calls exist (deep-dive into one document) but are the
   exception, never the navigation mechanism.
3. **Summoned deliberately.** Browsing, searching, and jumping to sources are free UI operations.
   Alioth is invoked when the user wants synthesis, extraction, or connection-finding — the
   collaborator inside the instrument, not the instrument itself. That is intelligence
   augmentation rather than chatbot-with-tools.

## Components

### Provider layer

One abstraction (Vercel AI SDK) over Anthropic / OpenAI / Ollama (D5: BYOK cloud + optional
local). Keys live in the OS keychain via `safeStorage` — never the DB, never config files. Model
routing per task class: cheap models for sweeps, strong models for synthesis and dialogue.

The provider layer is **shared infrastructure**: Orion's extraction passes route through the same
abstraction, so keys, routing, cost accounting, and token-spend visibility live in exactly one
place.

### Context assembler

The heart of the token economics. Given a request, it queries the index — FTS5, sqlite-vec, and
graph-neighborhood traversal — and assembles the relevant subgraph + source excerpts + provenance
URIs into the prompt. The expensive understanding already happened in Orion's pipeline; the
assembler only *selects*.

### Skills

Named, typed operations. Each skill declares its context recipe and its write permissions; the
write-back rules from 03 apply without exception.

| Skill | Invocation → result | Writes |
|---|---|---|
| `navigate` | question → grounded answer with jump-to-source targets | nothing |
| `synthesize` | topic or selection → grounded note | Markdown into the Obsidian vault, native format, provenance frontmatter |
| `connect` | node or neighborhood → proposed edges with rationale | index edges, only after user confirmation (user-asserted origin) |
| `extract` | one document, on demand → graph candidates | index — a deliberate, single-document run of Orion's extraction machinery |

`extract` is the explicit bridge between the two subsystems: bulk extraction at ingestion belongs
to Orion; a user saying "read this one deeply, now" invokes the same machinery through Alioth,
deliberately, with the spend visible.

### Dialogues

Conversations are persisted as files — Markdown + JSON metadata in `.astrolabe/dialogues/` —
linked to the nodes and documents they discussed. Open, portable, syncable (D11). In v1 dialogues
are stored and linkable; becoming first-class graph feeders is a later layer on the same spine
(D4).

## What Alioth never does

Recorded so scope gravity has something to push against:

- **Never builds or maintains the graph in bulk** — that is Orion's job (09)
- **Never syncs or ingests** — that is the connectors' job (03, Layer 2)
- **Never writes outside the write-back rules** — every write lands in the system of record that
  owns the data type, in its native format
- **Never spends tokens without a deliberate invocation** — no background chatter, no ambient
  polling, no re-prompting loops
- **Never owns content** — its only first-party artifacts are dialogues, and those are open files
  in the user's workspace

## Token economics

Alioth's per-invocation cost is low *because of everything beneath it*: connectors are zero-token,
Orion's costs were paid once at ingestion, and the context assembler hands the model a finished
context instead of tools to wander with. The full cost table lives in 03.

## Roadmap placement

Phase 3 (weeks 10–14): context assembler, dialogue surface with streaming, skills v1
(`navigate`, `synthesize`, `connect`), persisted dialogues, BYOK key management, model routing,
token-spend visibility. Depends on Phase 2 — Alioth without Orion's graph would be a chatbot,
which is precisely what this product is not.
