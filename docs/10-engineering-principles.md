# 10 — Engineering Principles

**Status:** Living document — the operating rules for this repo; revised by ADR · **Date:** 2026-07-07

The operating principles for anyone — human or agent — writing code in this repo. Structure and
irreversible choices live in the [ADRs](adr/); this document is the **how we work**, and it cites the
ADRs rather than restating them. Most of these are carried from the sibling Polaris project's proven
practice and adapted to Astrolabe's shape; each traces to something in the
[prior-iterations audit](01-prior-iterations-audit.md) or the founding
[design decisions](02-design-decisions.md).

One meta-rule first: **these principles are themselves reviewable.** ADR-0006 exists because a good
rule (blanket TDD) over-generalized into waste and had to be narrowed. Retraction and refinement are
first-class moves, recorded as ADRs — the founding docs are a starting position, not a frozen one.

---

## 1. Own no content; the index is derived and rebuildable

The inviolable principle (ADR-0001): Astrolabe owns only connections, intelligence, and dialogue. Its
entire index is derived from the systems of record and regenerable by a "Rebuild index" action that
must always exist and always work (ADR-0005). No user data lives only in the index; every node and
edge carries a provenance URI. **Why:** it is simultaneously the open-standards story, the privacy
story, and the structural guarantee that this iteration cannot die the way the previous four did.
**How to apply:** when tempted to store something new, ask *which system of record owns this type?* and
write it there in native format; the index only ever holds a derived, anchored copy.

## 2. Build (and type) on consumption, not on speculation

An abstraction, a strict type, or a seam is built the moment a real consumer needs it — not in
anticipation. **Why:** iteration 3 shipped a local/remote `ServiceFactory` against an API that did not
exist and 4k lines of tests on a layer no feature used; the plumbing was never consumed. Strict fields
entered by staff with no downstream reader are pure friction. **How to apply:** every speculative seam
needs a present consumer or a written trigger naming the future one (the Polaris strict-typing pattern:
"keep freeform until a *machine* reads the structure"). ADR-0007 is this rule at the roadmap altitude;
ADR-0003 is it applied to the `alidade` repo.

## 3. TDD scaled to stakes × logic

Test-first for anything that branches, transforms, or enforces a rule, and for anything
security/data/license/token-bearing — at the tiers the risk warrants (ADR-0006). Design tokens,
colours, copy, config, and one-line stdlib wrappers are **not** red-green subjects. The decisive
filter: *would this test ever fail for a reason other than someone changing a value on purpose?* If
no, it is a change-detector — do not write it. **Why:** iteration 2 was test-config theater (coverage
tooling, zero real tests); iteration 3 was 4k lines on one layer while the UI shipped untested; both
are the same waste from opposite directions. **How to apply:** the Tier-A spine here is connector
parsing, index/graph operations, provenance resolution, the context assembler's retrieval, Ed25519
verification, and the salvaged `buildPageMap`/`findTocPathsForPages` algorithms — port those *with*
tests. Unsure which tier? Ask; do not reflexively test.

## 4. Fail closed

The default state is denied/absent; presence must be earned. **Why:** a fail-open default is a silent
breach or a silent data loss. **How to apply:** no license token → do not run as licensed; config
parse failure → boot failure, not a half-configured app; a connector that cannot reach its source →
that source dims, the app does not crash; missing provenance → the node does not enter the graph. The
Electron boot order is DB → IPC → window with a **fail-fast quit** for exactly this reason.

## 5. Enforcement is mechanical where it guards a boundary; cultural where it needs judgment

A rule whose violation is a defect regardless of intent gets **teeth** — a linter zone, an
import-graph test, a CI gate. A rule that needs case-by-case judgment stays **cultural** and lives on
review. **Why:** boundaries drift under a blanket honor system, but judgment rules (like TDD altitude)
become change-detectors when mechanized. **How to apply for Astrolabe:** the connector-isolation
claim ("a broken connector dims one source, never the app") should earn a mechanical test — an
import-graph check that no connector imports another, plus a disable-rehearsal proving the app builds
green with any one connector removed. Otherwise it is a cultural claim, and this project's audit is
precisely about claims that were not true in code (the fake `randomBytes` "content hash", the BLOB
storage the README described but the schema never had).

## 6. Disposability as an acceptance criterion

Modularity is not claimed, it is proven by deletion. **Why:** Polaris's `notes` exemplar must be
removable — delete the folder + its registry lines + its migrations and the foundation stays green,
enforced by rehearsal and a continuous confinement test. **How to apply:** each connector, each
skill, and the `.astrolabe/` workspace format should be disposable in the same sense — removing a
connector, or deleting and rebuilding the index, leaves a green build and a working app. If it does
not, the coupling is a bug.

## 7. One name per concept

Glossary: **Astrolabe** (app), **Alioth** (agent harness), **Orion** (knowledge engine), **alidade**
(licensing API), **connector**, **index**, **node/edge**, **provenance**, **View** (saved lens),
**Dialogue** (persisted agent conversation). UI labels match code identifiers. **Why:** iteration 1
cost real comprehension with `Note` in code, "View" in the UI, and a `NoteEditor` that rendered
Excalidraw. **How to apply:** name a concept once; if the UI and the code disagree, that is a bug to
fix, not a synonym to tolerate.

## 8. Docs are written from code; one fact, one home

No aspirational docs. A README or design doc describes **what exists**; forward-looking plans are
marked as plans (this doc set, and specs, are explicit about pre-implementation status). Normative
content is never duplicated across documents — each fact has one owner and others cite it. **Why:**
iteration 3's README described BLOB storage and content hashing that never existed, because the docs
were generated before (and independent of) the code. **How to apply:** when a doc and the code
disagree, one of them is a bug; fix the code or correct the doc, never leave both. Boundaries → ADRs;
how-we-work → this doc; architecture → doc 03; each cites, none restates.

## 9. Explicit modeling; no magic strings; stable identity

State is modeled in the schema, not smuggled in string sentinels. Identity is stable and content-based
where it matters. **Why:** iteration 3's soft-delete was a magic `'trash'` string the schema never
defined, and its "content hash" was `crypto.randomBytes(8)` — random, not a hash, giving no dedup and
no integrity despite the README's claim; iteration 1 keyed files by filename, so duplicates collided.
**How to apply:** soft-delete via a schema column (`deletedAt`/status enum); real SHA-256 where
identity is content (documents, ink pages); provenance URIs as stable join keys — never filename
identity, never a value labeled "hash" that is not one.

## 10. Secure by default; secrets in the keychain

Electron hardening is non-negotiable and mechanical: `contextIsolation: true`,
`nodeIntegration: false`, a contextBridge-only preload surface that is an explicit allowlist,
navigation containment. BYOK keys live in the OS keychain via `safeStorage` — never the DB, never
config files, never committed. **Why:** an Electron app is shipped JavaScript reaching a local
filesystem and localhost APIs; the renderer must not hold Node. **How to apply:** verify the
*behavioral consequence* in tests (renderer has no `window.require`; the bridge exposes exactly its
allowlist), not the config literal — a config assertion is a change-detector (principle 3).

## 11. Zero-token by default; tokens spent deliberately and visibly

The token economics are a design principle, not just a cost note. Connectors, search, graph browsing,
and deep links are **zero-token** pure code. Extraction (Orion) spends tokens **once per document at
ingestion**, batched, resumable, and cost-visible. Alioth spends per **deliberate** invocation, made
cheap by pre-assembled context. **Why:** it is the whole answer to "why not just point a generic agent
at MCP servers" — a generic harness pays for discovery every session; Astrolabe pays once and
navigates for free (Vision doc; Architecture token table). **How to apply:** never add a background
loop that spends tokens without a user action; keep every spend batched, resumable, and shown.

## 12. Build-vs-buy, stated; constrain by construction

Reach for a library on a hard problem (SQLite/Drizzle, the Vercel AI SDK, pdf.js, Sigma.js, Zod);
hand-roll only thin glue. Prefer making a wrong value **unrepresentable** over validating against it.
**Why:** hard problems have battle-tested solutions, and a control that cannot hold a bad value beats
a check that catches one. **How to apply:** a fixed-domain choice becomes a typed enum or a `<select>`,
not a free field with a validator; the constraint *is* the rule.

## 13. Small green commits; the red→green story is the review artifact

Infrastructure changes land as their own reviewable commits (the Electron-graft pattern generalizes).
Commits are small, descriptive (Conventional Commits with scopes), and green. Dependencies enter in
the commit whose use justifies them. **Why:** iteration 1's working tree was left mid-teardown and did
not build; small green commits make each step reviewable and bisectable, and the red→green sequence
*is* the record of why each line exists. **How to apply:** one logical change per commit; never a
commit that leaves the tree red; no committed artifacts (`schema.js`, `coverage/`, generated `docs/`,
`.env` — iteration 3 committed all four).

---

## Where each principle is enforced or proven

| Principle | Home / teeth |
|---|---|
| Own no content; derived index | ADR-0001, ADR-0005; "Rebuild index" action (Phase 1) |
| Build on consumption | ADR-0003, ADR-0007 |
| TDD altitude | ADR-0006; the test suite; review |
| Fail closed | boot sequencer; connector degradation; license path |
| Mechanical vs cultural enforcement | connector import-graph test (to build); ESLint; review |
| Disposability | index rebuild; connector disable-rehearsal (to build) |
| One name per concept | glossary (this doc §7; [07](07-development-setup.md)) |
| Docs from code; one fact, one home | review at each phase close; ADRs own boundaries |
| Explicit modeling / identity | schema review; no magic strings |
| Secure by default | Electron smoke tests (behavioral, not config-literal) |
| Zero-token by default | Architecture token table; code review |
| Build-vs-buy; constrain by construction | Tech Stack doc; review |
| Small green commits | CI green gate; commit conventions |
