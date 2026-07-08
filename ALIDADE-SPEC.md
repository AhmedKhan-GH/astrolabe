# Alidade Spec — Repository & Engineering Blueprint

**Status:** Living document — pre-implementation blueprint for the `alidade` repository · **Date:** 2026-07-07

The repository-and-engineering *how* for alidade: bootstrap sequence, architecture, layers,
packages, and growth path. The **licensing mechanism, endpoint contracts, and anti-piracy layers**
live in [`COMMERCIALIZATION-SPEC.md`](COMMERCIALIZATION-SPEC.md); the commercial **policy** lives in
[`docs/05`](docs/05-licensing-and-commercialization.md). This spec cites both and adds only the
build blueprint. One fact, one home.

This document lives in the astrolabe repo because the alidade repo does not exist yet — it moves to
(or is copied into) the alidade repo as its founding doc on creation day.

---

## 0. Scope — and a recorded scope expansion

**As founded (doc 05, ADR-0003):** alidade is Astrolabe's tiny licensing/update API (~5 endpoints).

**As now intended (2026-07-07 session):** alidade is the **headless backend for the organization** —
licensing and updates for Astrolabe first, then service identity and project/resource coordination
for the org's other projects. API-only; no UI (an admin dashboard, if ever, is a separate client).

> **Governance note:** this is a boundary change to ADR-0003's scope. It is recorded here as
> *intended*; the ADR is amended (or a successor ADR written) **on the day the repo is created**,
> when the expansion becomes real. Law and enforcement change together, not before.

**What does not change:**

- **The creation gate.** The repo is created when its **first real consumer** ships — Astrolabe
  Phase 6, or an earlier org project with a genuine need. Never speculatively (iteration-4 scar,
  ADR-0007). Each *module* inside alidade obeys the same rule.
- **The boundary tables.** Alidade never stores user content (ADR-0001), never resells inference
  (ADR-0004), never becomes a hosted-accounts data platform for Astrolabe users (D7).

## 1. Bootstrap (JetBrains, empty Node — never express-generator)

WebStorm's Express generator emits 2013-era CommonJS/Jade scaffolding with near-zero overlap with a
strict-TS headless API (analysis: 2026-07-07 session). The D13 lesson transfers: **graft what you
understand; don't tear out what a wizard assumed.**

| Commit | Contents |
|---|---|
| 1 | **WebStorm → New Project → Node.js (empty)**, pnpm. `pnpm init`; strict tsconfig (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, ESM) — iteration 4's tsconfig was its one good artifact; port the discipline. ESLint 9 flat + typescript-eslint. `tsx` for dev, `tsc` for build. `.gitignore` (env, dist, node_modules) |
| 2 | Express + `helmet` + `cors` + typed error/404 middleware (problem+json) + `GET /health` → a running, typed server |
| 3 | `lib/env.ts` — zod-validated env, **fail-closed at boot** |
| 4 | `lib/logger.ts` — pino + `pino-http` (JSON always; pretty only via local pipe) |
| 5 | Drizzle + postgres.js against Supabase; `drizzle-kit` migrations; `lib/db.ts`; Testcontainers migration smoke test (fresh-clone proof) |
| 6 | Vitest + supertest harness; CI (typecheck, lint, unit, integration) |
| 7+ | First domain module (licensing), TDD Tier-A (ADR-0006) |

Every commit green, small, Conventional Commits with scopes — the red→green story is the review
artifact (doc 10 §13).

## 2. Architecture — modular monolith

One deployable; strict internal boundaries (the Polaris charter discipline mapped to a backend).
Microservices/distributed Go remain rejected by an order of magnitude (D10) — Notion runs a
monolith; alidade's load at 10k customers is a few requests/minute.

```
alidade/
  src/
    lib/                      # foundation — NEVER imports modules/
      env.ts                  #   zod-validated env; parse failure = boot failure
      db.ts                   #   Drizzle client + pool (the only DB entry point)
      logger.ts               #   pino instance (the only logger)
      crypto.ts               #   Ed25519 / jose EdDSA sign+verify helpers
      http.ts                 #   AppError types, asyncHandler, problem+json writer
      rate-limit.ts           #   rate-limiter factory ONLY (modules own instances)
    modules/                  # domain slices — NEVER import each other
      licensing/              #   routes.ts · service.ts · schema.ts · *.test.ts
      updates/                #   update-feed manifest endpoints
      billing/                #   MoR webhook ingestion (idempotent on event id)
      identity/               #   v2 — service accounts, scoped API keys
      projects/               #   v3 — org project/resource registry
    registry.ts               # composition root: flat list mounting module routers — zero logic
    app.ts                    # express wiring: helmet, cors, pino-http, registry, error handler
    server.ts                 # boot: env → db → migrations check → listen; fail-fast quit
  drizzle/                    # generated migrations (committed; runtime-needed — iteration-2 scar)
  e2e/                        # API-level supertest suites against a booted app
```

**Iron rules (enforced mechanically once the tree exists — import-graph test, the Polaris pattern):**

1. `lib/**` never imports `modules/**`.
2. Modules never import each other; shared needs go through `lib/` contracts.
3. `registry.ts` is the only wiring point; it imports routers only.
4. One env reader, one DB client, one logger.
5. **Every route self-guards**: auth middleware + zod parse at the boundary + rate-limit decision
   visible in the handler chain. No route trusts upstream routing for authz.
6. A module is disposable: delete its folder + its registry line + its migrations → green build
   (proven by rehearsal when the second module lands).

### Module anatomy

`routes.ts` (Express router: zod-parse → service call → problem+json errors) · `service.ts` (domain
logic; the only file touching `lib/db`) · `schema.ts` (Drizzle tables + zod DTOs) · colocated
`*.test.ts`. Outsiders import a module only through its `index.ts` dev API.

## 3. Layers & packages (each enters with its consumer)

| Layer | Packages | Enters |
|---|---|---|
| HTTP | `express`, `helmet`, `cors`, `pino-http` | commit 2 |
| Validation | `zod` — every boundary: env, params, bodies, webhooks | commit 2–3 |
| Logging | `pino` | commit 4 |
| Data | `drizzle-orm`, `drizzle-kit`, `postgres` (postgres.js) | commit 5 |
| Tokens/auth | `jose` (EdDSA JWTs: license tokens *and* service API tokens — one mechanism) | licensing module |
| Abuse | `rate-limiter-flexible` (memory now; Redis when >1 instance) | first public endpoint |
| Email | Resend or Postmark SDK | license delivery |
| Jobs | `bullmq` + Redis — **only when** a real queue need appears (webhook retries) | deferred |
| Testing | `vitest`, `supertest`, `@testcontainers/postgresql` | commit 6 |
| Ops | Docker, GitHub Actions, Sentry | first deploy |

## 4. Data — Supabase as managed Postgres (decided 2026-07-07)

**Supabase over Neon**, for two reasons: the platform fluency already paid for in Polaris (GoTrue,
RLS patterns, live-suite CI gating), and **option value** — v2 identity can adopt GoTrue instead of
hand-rolling or bolting on a third service. Neon's branching is the feature given up; acceptable.

**Discipline (D11 holds):** Supabase is *infrastructure, not architecture*. Drizzle talks to a
Postgres connection string; GoTrue, if ever used, is used by alidade internally. **No Supabase
client SDK in Astrolabe or any other client** — alidade's API is the only boundary. The vendor
stays swappable (it is just Postgres + a token issuer behind our own API).

**RLS stance:** unlike Polaris (whose browsers hit the DB directly), alidade is a **single trusted
client** of its own database — so application-level authz + a non-superuser runtime role is the
baseline, and RLS is optional defense-in-depth to be adopted *deliberately*, not inherited
reflexively. Decide at the identity module (D-ALI-3). Runtime role is never superuser; migrations
run as a privileged role (least privilege carried from Polaris regardless).

## 5. Testing (ADR-0006 applies unchanged)

| Tier | Harness | Covers |
|---|---|---|
| Unit | Vitest, mocked collaborators | token sign/verify, activation-count logic, webhook idempotency, zod schemas with rules |
| Integration | Vitest + Testcontainers Postgres (real `postgres:17`, real migrations, non-superuser role) | services against a real DB; migration smoke = fresh-clone proof |
| API/E2E | supertest against the booted app | endpoint contracts, auth failures, problem+json shapes |

Licensing and billing are **Tier-A** (money/security): test-first, red → green → commit, all
warranted tiers. Update-feed manifest formatting is Tier B. No change-detector tests; no suite that
can silently skip in CI.

## 6. Delivery & operations

- **Docker** (multi-stage: build → slim runtime), `HEALTHCHECK` on `/health`.
- **GitHub Actions:** typecheck → lint → unit → integration (Testcontainers) → build image; deploy
  on tag. A fresh clone + documented commands reproduce CI exactly (D10 Polaris discipline).
- **Deploy:** Fly.io/Railway-class, one instance; stateless app (all state in Postgres/Redis) so
  scaling is `replicas: 2`, never a topology change.
- **Performance levers, in order:** Postgres indexes/query shape → pooled connections (Supabase
  pooler) → statelessness. The framework is not the bottleneck at this scale (D10).
- **Secrets:** platform-managed env; the Ed25519 private key exists only here. Never in the repo.

## 7. Growth path (module ⇢ consumer)

| Version | Modules | Consumer that justifies it |
|---|---|---|
| v1 | `licensing`, `updates`, `billing` | Astrolabe Phase 6 (contracts in COMMERCIALIZATION-SPEC §2) |
| v2 | `identity` (service accounts, scoped API keys via jose; optionally GoTrue) | the first *other* org project needing authenticated access |
| v3 | `projects` (org project/resource registry) | defined by the second real consumer — **not speculated now** |

## 8. Open decisions

- **D-ALI-1 — Creation trigger:** Astrolabe Phase 6 vs an earlier org-project consumer (whichever
  ships first; the ADR-0003 amendment lands then).
- **D-ALI-2 — D-COM-1 interaction:** the org-platform scope strengthens self-building licensing
  (the backend exists anyway) vs Lemon Squeezy's License API. Resolve together.
- **D-ALI-3 — RLS in alidade:** app-level authz only, or RLS defense-in-depth; decide at the
  identity module.
- **D-ALI-4 — GoTrue vs hand-rolled service identity** for v2.
- **D-ALI-5 — Redis adoption point** (rate-limit store + BullMQ) — deferred until >1 instance or a
  real queue need.

## 9. Non-goals

UI of any kind (headless; a dashboard is a separate client, if ever); microservices / Go /
distributed topology (D10 — dead until the numbers demand it); GraphQL (5–15 REST endpoints do not
need a query language); user-content storage (ADR-0001); inference (ADR-0004); hosted Astrolabe
accounts (D7); multi-tenancy machinery for third parties (alidade serves *one* organization).

---

*Analysis-driven and pre-implementation. On creation day: amend ADR-0003 (scope), resolve D-ALI-1/2,
then execute §1's commit sequence under TDD (ADR-0006).*
