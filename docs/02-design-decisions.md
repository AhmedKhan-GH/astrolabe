# 02 — Design Decisions

**Status:** Current — founding design session; irreversible items formalized as [ADRs](adr/) ·
**Date:** 2026-07-07

Record of every decision made in the founding brainstorming session (2026-07-07), with the question
asked, the options considered, the answer chosen, and the rationale. These are commitments, not
suggestions — relitigating them is the failure mode of iterations 1–4.

---

## D1. The core moment: one continuous flow

**Question:** When Astrolabe works perfectly, what is the single moment that makes it irreplaceable?

**Options:** (a) AI-accompanied deep reading — magic *during* reading; (b) synthesis across
everything — magic *after* capture, reading happens anywhere; (c) the living graph itself as the
product; (d) one continuous flow — all three in one surface.

**Decision: (d) One continuous flow.** Capture, AI-accompanied reading, and graph synthesis must
ultimately live in one surface or the product loses its point. This is the most ambitious answer;
it is honored *eventually* — D6 (ride Zotero first) sequences the reading surface into v2 without
changing the destination.

## D2. Handwritten notes: ingestion pipeline, not ink surface

**Question:** Where does handwritten ink come from and what must Astrolabe do with it?

**Options:** ingest from outside (iPad/GoodNotes/Notability/paper → import, OCR, link, index);
native ink canvas inside Astrolabe; both phased; ink as optional garnish.

**Decision: Ingest from outside.** The user writes on iPad or paper. Astrolabe imports the
pages/PDFs, OCRs the handwriting (vision model via the provider layer, Tesseract as local
fallback), and links + indexes the content into the graph. Astrolabe never needs a pen input
surface. This keeps a drawing engine — an enormous scope item — permanently out of the core product.

## D3. End state: orchestrator — the tools stay as systems of record

**Question:** Two years from now, Astrolabe is the daily driver — are Zotero, Obsidian, and Eagle
still running on the machine?

**Options:** no, Astrolabe replaced them; yes, they stay as systems of record; transitional bridge
then replace; only the formats survive.

**Decision: Yes — they stay as systems of record.** Zotero keeps citations, Obsidian keeps the
vault, Eagle keeps visual assets. Astrolabe connects to all three (local APIs / file watching), adds
the AI + graph + navigation layer on top, and **writes back into them in their own formats**. This
is the founding reframe (see [00 — Vision](00-vision.md)) and the source of the inviolable
principle: Astrolabe owns no content.

Combined with D1, the resolution is: **one surface (Astrolabe's UI), three systems of record
underneath.**

## D4. AI state, v1 essential: the knowledge graph

**Question:** What state must the AI hold between sessions to feel like "building and navigating
together" rather than a chatbot bolted onto a viewer?

**Options (multi-select):** reading state; the knowledge graph; dialogue memory; task/intent state.

**Decision: The knowledge graph is the v1 essential.** A persistent graph of concepts, claims, and
entities extracted from documents, annotations, and notes — grown incrementally, queryable, and used
to ground every Alioth answer. Reading state, dialogue memory as first-class linked artifacts, and
task/intent awareness are later layers on the same spine, not v1 requirements.

## D5. AI runtime: BYOK cloud + optional local

**Question:** How does the AI run, especially for a paying customer?

**Options:** BYOK + optional local (Ollama); bundled cloud subscription (reselling inference);
local-only; tiered.

**Decision: BYOK cloud + optional local.** The user plugs in their own Anthropic/OpenAI key, or
points at Ollama for fully-local inference. Astrolabe sells the app license, not tokens — this keeps
the business out of inference reselling, fits the local-first ethos, and enables one-time/perpetual
license pricing. A managed-AI tier can be added post-revenue without architectural change because
everything goes through one provider abstraction.

## D6. Reading surface: ride Zotero first, own reader in v2

**Question:** Does v1 build Astrolabe's own PDF reader, or ride Zotero's reader first?

**Options:** own reader in v1; ride Zotero first; own read-only viewer with Zotero-side annotation.

**Decision: Ride Zotero first.** V1 ingests Zotero's annotations and reading state, builds the
graph, and offers AI navigation + synthesis inside Astrolabe; clicking a source deep-links into
Zotero's reader at the exact page (`zotero://` URIs). The in-app reader — where the Views concept
from iteration 1 returns — is v2, built inside the same shell once the graph has proven value. Ships
months sooner and validates the differentiated layer before rebuilding a commodity one.

## D7. Login scope: license activation only

**Question:** What does "logging into Astrolabe" mean, given data and AI keys are local?

**Options:** license activation only; account + E2E graph sync; full cloud identity (Notion-style).

**Decision: License activation only.** An account exists to validate the license and enable
updates — sign in once, works offline after. All data, the graph, and API keys stay on-device.
Alidade (the backend) is therefore a tiny licensing/update API, not a data platform. Hosted sync is
an explicit post-revenue maybe (see D11).

## D8. Architecture: the Conductor app (Approach A)

**Approaches considered:**

- **A. Conductor app (chosen):** an Electron desktop app connecting to local systems of record —
  Zotero local HTTP API (proven by the user's patched keyless zotcli setup), the Obsidian vault as
  plain files under a watcher, Eagle's localhost:41595 API. It builds the graph + embeddings + OCR
  text as a **derived, rebuildable index** in its own SQLite. UI = graph navigator, dialogue
  surface, cross-tool search; every node deep-links out via `zotero://`, `obsidian://`, `eagle://`.
  Writes land in the target tool's format.
- **B. Plugin swarm (rejected):** Obsidian plugin + Zotero plugin + background daemon. Cheapest, but
  can never deliver one continuous flow; fragments across three host UIs; capped by plugin
  sandboxes; three products to commercialize.
- **C. Standalone with format compatibility (rejected):** own storage, own reader, import from the
  others. Rejected by D3 directly — and it spends months rebuilding library management that Eagle
  and Zotero already do better, the precise reinvention this project exists to avoid.

**Risk noted for A:** dependency on three external local APIs. Obsidian = plain files (zero risk);
Eagle's localhost API is stable; Zotero's local API is the one to monitor. Mitigation: connectors are
isolated modules behind interfaces; a broken connector degrades one source, not the app.

## D9. Repositories: two separate repos, no monorepo

**Question:** monorepo (`apps/astrolabe`, `apps/alidade`, `apps/web`, `packages/shared`) or separate
repos?

A pnpm + Turborepo monorepo was recommended (shared license-verification code and API types); the
user chose **two separate repos**: `astrolabe` (the app) and `alidade` (the API, created only when
the commercialization phase begins). The shared-code cost is accepted deliberately: the Ed25519
verification is ~20 lines against a stable spec — duplicate it consciously, or extract a tiny
private npm package if it ever grows. Recorded so the duplication is never "discovered" as an
accident.

## D10. Backend framework: Express (résumé-standard), sized to five endpoints

Hono was the initial recommendation (modern, tiny, typed). The user optimized for industry-standard
résumé value: **Express** on Node + TypeScript. At alidade's size (~5 endpoints + a payments
webhook) the framework choice is aesthetic; Express is the most recognized backend framework in
existence and is fully adequate. A **distributed Go backend was explicitly rejected as overkill by
an order of magnitude**: 10,000 paying customers generate a few requests per minute (webhook once,
activation once per machine, update ping daily). Undifferentiated infrastructure is rented: Paddle
(billing), managed Postgres (Neon/Supabase), Cloudflare R2 (artifacts), GitHub Actions (CI).

## D11. Sync layer: none in v1 — piggyback on existing sync; PowerSync/ElectricSQL are non-goals

PowerSync, ElectricSQL, Turso replicas, Rocicorp Zero, and CRDT stacks all assume a **cloud source
of truth replicating down to devices**. Astrolabe is the inverse: sources of truth are already on
the user's device, and the index is derived and rebuildable. There is nothing to replicate.

**Multi-device story without any sync infrastructure:** the systems of record already sync
themselves (Zotero sync; Obsidian via Obsidian Sync/iCloud/Syncthing). A second machine's connectors
see the same synced sources and rebuild the index locally. Astrolabe's own artifacts (dialogues,
views, graph annotations) are small JSON/Markdown files in `.astrolabe/` that ride the user's
existing file-sync. Hosted graph sync (E2E-encrypted blob model, à la Obsidian Sync) is a
post-revenue alidade-v2 option only.

**Supabase's one legitimate role today:** interchangeable managed Postgres for alidade's license
records (vs Neon — either is fine). Its client SDK and auth do not enter the desktop app; alidade's
endpoints are the only boundary.

## D12. Industry context recorded (what the four reference companies run)

- **Notion:** Node.js + TypeScript **monolith**, PostgreSQL sharded across 480 logical shards / 32
  physical DBs (routed by `workspace_id % 480` in TypeScript), PgBouncer, Redis, WebSockets, AWS +
  Kubernetes. Even at their scale: a monolith — they scaled the database, not the service topology.
  Their backend is the product because they host the documents; Astrolabe deliberately does not.
- **Zotero:** open source — client on the Firefox platform; sync backend (`zotero/dataserver`) is
  PHP + MySQL (written ~2009; legacy, not a recommendation) + Node stream server + S3 attachments.
- **Obsidian:** closed and undisclosed; team of under a dozen serves millions because the app runs
  entirely on-device and the backend is only Sync/Publish/licensing — so small they don't blog
  about it. **This is the shape alidade copies.**
- **Eagle:** never publicized; Electron app, everything on-device, visible backend ≈ website +
  checkout + license activation. The closest existing analog to Astrolabe's whole commercial model.

Sources: notion.com/blog/sharding-postgres-at-notion, notion.com/blog/the-great-re-shard,
labs.relbis.com/blog/2024-04-18_notion_backend, forum.obsidian.md/t/technology-behind-obsidian-sync,
github.com/zotero/dataserver.

## D13. Scaffold decision

WebStorm wizard: **Vite generator → React template → TypeScript** (`react-ts`), then Electron
grafted on as a second, separately-reviewable commit (`electron`, `electron-vite`,
`electron-builder`; code moves to `src/renderer/`; `src/main/` + `src/preload/` added). The
JetBrains wizard has no Electron generator; starting from a web template and "adding Electron later"
without actually wiring it is how iteration 1 shipped a phantom desktop app — the graft is therefore
an explicit, immediate step, not a someday.
