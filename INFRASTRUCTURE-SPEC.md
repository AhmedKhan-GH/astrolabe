# Infrastructure Spec — Foundation Pillars

**Status:** Living document — pre-implementation spec for the next infrastructure phases · **Date:** 2026-07-07

This spec is the deep *how* for the three foundation pillars that complete Phase 0 and underpin
Phase 1: **testing, logging, and the local database.** It complements — does not restate — the
phase-by-phase ordering in [`docs/06-roadmap.md`](docs/06-roadmap.md), the operating rules in
[`docs/10-engineering-principles.md`](docs/10-engineering-principles.md), and the decisions in
[`docs/adr/`](docs/adr/). One fact, one home: where a rule already lives, this cites it.

The choices here are **already committed** (tech stack doc 04, ADR-0005, ADR-0006) — this is a build
plan, not a design debate. Relitigating the stack is the recorded failure mode of iterations 1–4.

---

## Governing principles (cited, not restated)

- **TDD scaled to stakes × logic** — test-first for branching/transforming/rule-enforcing and
  anything security/data-bearing; never a change-detector (ADR-0006, doc 10 §3).
- **Fail closed** — DB init failure → fail-fast quit; no session/keys → deny (doc 10 §4).
- **Derived and rebuildable index** — the DB is never a system of record; a "Rebuild index" action
  always exists and works (ADR-0005, doc 10 §1).
- **Build on consumption** — wire each pillar with its smallest real consumer; no schema without a
  domain, no repository/service layers before a table needs them (doc 10 §2; the iteration-2/3 scar).
- **Small green commits** — each pillar lands as its own reviewable commit; the red→green story is
  the review artifact (doc 10 §13).

## Sequencing

**Testing → Logging → Database.** Rationale: testing first so the rest lands test-first; logging
before the database so DB init and its failures have somewhere structured to go; the database last
because it is the largest pillar and depends on both.

---

## Pillar 1 — Testing (`Vitest` + `Playwright-for-Electron`)

**Decision (doc 04):** Vitest + Testing Library for unit/component; Playwright-for-Electron for E2E.
Rigor by altitude (ADR-0006).

### Tiers for a desktop app

| Tier | Tool | Scope | Note |
|---|---|---|---|
| Unit | Vitest (node + jsdom projects) | pure logic: connector parsers, the salvaged `buildPageMap`/`findTocPathsForPages`, the context assembler, the DB table-client dispatch | **Tier-A, test-first** |
| Integration | Vitest + **real better-sqlite3 in a temp dir** | DB operations, migrations, provenance | replaces Polaris's Testcontainers-Postgres — desktop tests hit a real on-disk SQLite, not a container |
| E2E | Playwright `_electron` | app launches, window renders, security posture, user journeys | runs the built app |

### First artifact — the launch smoke test

The behavioral (not config-literal) assertions:

1. App launches; a window becomes visible; React rendered (assert on a real DOM locator).
2. `window.astrolabe` exposes **exactly** its allowlist and nothing more.
3. The renderer has **no** `window.require` / `window.process` (context isolation proven by
   consequence, not by asserting the config object — that would be a change-detector).
4. Clean boot: fail on any `pageerror` or main-process stderr during startup.

### What is NOT tested (Tier C / not-a-subject)

The template UI (no logic yet), config literals, design tokens, Vitest/Playwright config themselves.
No test-config theater (iteration 2 had coverage tooling and zero real tests).

### Files

`vitest.config.ts` (node + jsdom projects), `playwright.config.ts`, `e2e/` harness, `*.test.ts`
colocated with source. CI runs typecheck + lint + unit on push; E2E and the packaged-app smoke join
at Phase 2 (see database pillar).

*Commit:* `test: vitest + playwright-for-electron harness + launch smoke`. **Status: landed
(2026-07-09).** The smoke's clean-boot assertion caught its first real defect on first run — the
template's root-absolute `/favicon.svg` / `/icons.svg` references 404 under `file://` in the built
app (fixed to relative paths). Deviation from plan: no jsdom project yet — it enters with the first
component test (build on consumption); unit tier runs `passWithNoTests` until the first Tier-A logic
lands rather than shipping placeholder specs.

---

## Pillar 2 — Logging (`Pino`, main process)

**Decision (doc 04, doc 07):** Pino, structured, with context objects (the alidate convention).

- **`src/main/logger.ts`** — one configured Pino instance. JSON to stdout in production; a file sink
  under `userData/logs` for post-hoc diagnosis.
- **Gotcha — `pino-pretty` is dev-only.** It runs as a worker thread and **breaks inside an asar**,
  so pretty transport is enabled only when unpackaged; the packaged app uses base Pino (JSON).
- **Renderer → main forwarding is deferred** — a small IPC channel, added only when there is renderer
  logic worth logging (build on consumption).
- **Altitude:** mostly Tier C (config). The one Tier-A shape is any *best-effort, must-never-block*
  semantic (à la Polaris's `recordSignIn` — a logging failure must never break the flow it observes);
  none exists yet, so it stays config-level until a flow needs it.

*Commit:* `feat: pino structured logging (main process)`. **Status: landed (2026-07-09).**
As-built: dev = pino-pretty + file via worker-thread transports; packaged = in-process
`pino.multistream` (JSON stdout + file) since transport workers can't resolve targets inside asar.
File sink at `userData/logs/main.log` (`…/Application Support/astrolabe/logs/`). `moduleLogger(mod)`
is the child-logger convention.

---

## Pillar 3 — Local database (`better-sqlite3` + `Drizzle`)

The largest pillar, and the one with the native-module ABI concern already understood by the team.

### Packaging & native-module wiring (the ABI story)

- **`better-sqlite3` + `drizzle-orm` in `dependencies`** (not dev) so electron-builder bundles *and*
  rebuilds them; `drizzle-kit` in devDependencies for migration generation.
- **Add the deferred hook now — this is its consuming moment:** `"postinstall": "electron-builder
  install-app-deps"` rebuilds native deps against the Electron ABI for `pnpm dev` and tests.
  Combined with the `asarUnpack: '**/*.node'` already in `electron-builder.yml` and electron-builder's
  packaging-time `@electron/rebuild`, dev and packaged both load a correctly-built binary — the fix
  for the recurring "works in node, crashes in Electron" mismatch.
- electron-vite's `externalizeDepsPlugin` already externalizes anything in `dependencies`, so
  better-sqlite3 is never bundled into the main chunk (which would break the native load).

### Boot & lifecycle

- **Boot order `DB → IPC → window`, with fail-fast quit** if DB init throws (doc 10 §4). WAL mode on.
  Drizzle migrations run on boot (dev + packaged path resolution — the iteration-2 gitignored-but-
  bundled-migrations scar is explicitly avoided; verify nothing runtime-needed is gitignored).
- **Location:** `.astrolabe/index.db` in the workspace directory (doc 03). Derived and rebuildable
  (ADR-0005) — the **"Rebuild index" action exists from the start**, proving the law before the graph.

### The typed IPC table-client (salvaged pattern, doc 01 salvage manifest)

- One generic `db:query` channel dispatching CRUD by table, plus a `db:custom` escape hatch; a
  `createTableClient<TSelect, TInsert>()` factory in the preload so Drizzle's `$inferSelect` /
  `$inferInsert` types flow **schema → IPC → renderer** with zero duplication.
- The dispatch **branches, so it is Tier-A test-first.**
- Known ceiling (recorded in the audit): the generic handler cannot express transactions, joins, FTS,
  or pagination — those fall to `db:custom`, and a proper repository/service layer arrives only when a
  real feature (Phase 1 connectors) needs it. **Do not build it ahead of that** (iteration-3 scar).

### Scope caution

Phase 0 wires the DB with **one trivial round-trip proven by a test** — never a schema with no domain
(iteration 2's exact mistake). **FTS5 and sqlite-vec are Phase 2**, not here: sqlite-vec is a loadable
extension needing its own `asarUnpack` + `loadExtension` and shipping the extension binary — real
complexity, correctly deferred.

*Commit:* `feat: better-sqlite3 + drizzle with typed IPC table-client`.

---

## Open decisions (resolve at implementation)

- **D-INF-1 — DB path:** `.astrolabe/index.db` in a user-chosen workspace vs. `userData/` for the
  app's own state. Doc 03 says workspace; confirm whether Phase 0 uses a default workspace or defers
  workspace selection to Phase 1.
- **D-INF-2 — Table-client generality:** how generic the `db:query` channel is before `db:custom`
  takes over (kept minimal per the audit).
- **D-INF-3 — Log file rotation/retention** under `userData/logs` (size/age cap).
- **D-INF-4 — Packaged-app smoke in CI:** pull the Playwright smoke against the *packaged* build
  forward to the moment better-sqlite3 lands (Phase 2), where dev-vs-packaged can first diverge.
- **D-INF-5 — Renderer→main log forwarding:** the phase it earns its IPC channel.

## Non-goals for these phases (recorded so they stay deferred)

FTS5 / sqlite-vec (Phase 2); connectors and any real schema/domain (Phase 1); repository/service
layers (until a feature needs them); renderer-side logging; the CI cross-platform build matrix and
signing (Phase 6).

---

*This spec is analysis-driven and pre-implementation. When a pillar's phase begins, turn its section
into a task-by-task plan (superpowers:writing-plans) and execute under TDD (ADR-0006).*
