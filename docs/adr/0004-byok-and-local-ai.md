# ADR-0004: AI is BYOK cloud + optional local; Astrolabe sells the license, not tokens

**Status:** Accepted
**Date:** 2026-07-07

## Context

The product runs entirely on-device (index, graph, connectors, agent). The open question was how AI
inference runs, especially for a paying customer: bundle a cloud subscription (resell inference),
require local-only, or bring-your-own-key. Reselling inference would put the business in the
per-token-cost-recovery trade, conflict with the local-first ethos, and prevent one-time/perpetual
license pricing.

## Decision

**BYOK cloud + optional local.** The user plugs in their own Anthropic/OpenAI key, or points at
Ollama for fully-local inference. Both run through **one provider abstraction** (Vercel AI SDK).
Astrolabe sells the **app license, not tokens**. Keys live in the OS keychain via Electron
`safeStorage` — never in the DB or config files. (Design decision D5.)

## Consequences

- Enables the Eagle-model commercialization (ADR context: pay once, runs on-device forever) with **no
  per-use cost to recover** — see [05 — Licensing & Commercialization](../05-licensing-and-commercialization.md).
- A managed-AI tier can be added **post-revenue with no architectural change**, because everything
  already goes through the one provider layer.
- The provider layer is shared infrastructure: both Orion's extraction passes and Alioth's dialogue
  route through it, so key handling, model routing, and cost accounting live in exactly one place.
- **Cost:** extraction quality/cost depends on the user's own key and model choice — mitigated by
  keeping ingestion pipelines batched, resumable, and **cost-visible** so users trust the spend
  (roadmap standing risks).
- **Rejected — bundled cloud subscription:** puts the solo business in inference reselling and kills
  perpetual pricing. **Rejected — local-only:** needlessly caps quality for users who have a cloud key
  and want it.
