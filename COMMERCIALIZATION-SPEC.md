# Commercialization Spec — Licensing, alidade & Anti-Piracy

**Status:** Living document — pre-implementation build plan for Phase 6 · **Date:** 2026-07-07

The implementation *how* behind the commercial model. The policy and rationale live in
[`docs/05-licensing-and-commercialization.md`](docs/05-licensing-and-commercialization.md) and the
decisions in [`docs/adr/`](docs/adr/) (0001 own-no-content, 0003 two-repos/alidade-timing, 0004
BYOK) — this spec **cites** those and adds only implementation detail: crypto, endpoint contracts,
the app-side seam, the anti-piracy layers, and the one open build-vs-buy decision. One fact, one
home.

**Sequencing gate (ADR-0003):** the `alidade` repo is created the day Phase 6 begins — **not
before** (iteration 4's three-month hello-world scar). Nothing here is built now; this is the plan
for when it is. The only thing that could land earlier is a single clean app-side `LicenseService`
seam, and even that waits for a settings surface to consume it (build on consumption).

---

## Governing principles (cited, not restated)

- **Eagle model:** pay once, license runs on-device forever; the server only mints, activates, and
  counts (doc 05). Optional cloud services, if ever, billed separately.
- **Own no content** (ADR-0001): alidade stores license records only — never user content, graph,
  keys, or settings.
- **Offline-first licensing:** activate once online, verify offline forever, revalidate
  opportunistically — never continuous call-home (doc 05 §license-lifecycle).
- **Honest anti-piracy** (doc 05 §anti-piracy): cryptography closes key-forging permanently; nothing
  closes code-patching — raise its cost, then stop. "Uncrackable" is the wrong target.
- **Fail closed** (doc 10 §4): no valid token → do not run as licensed; but never hard-lock a
  genuinely offline machine within the grace window.

---

## 1. The licensing mechanism (Ed25519 signed tokens)

### Keys

One Ed25519 keypair. **Private key lives only on the server** (managed secret, never in a repo). The
**public key is baked into the app** as a committed constant (a public key is not a secret). Node's
built-in `crypto` does Ed25519 sign/verify with zero dependencies (`generateKeyPairSync('ed25519')`,
`crypto.sign`/`crypto.verify`); **`jose` with EdDSA** is the alternative if a standard JWT token
format is preferred over a hand-rolled payload (recommended — buy the token format, see §6 open
decisions).

### Flow

1. **Purchase → key issuance.** Payment webhook → alidade mints a **license** = signed payload
   (`license_id`, email, edition, `max_activations`, issued_at) → persists → emails the key.
   Forging is impossible without the private key (problem *closed*).
2. **Activation (the one mandatory call-home).** App computes a **machine fingerprint**
   (`node-machine-id`, hashed), POSTs `{ key, fingerprint }`. alidade verifies the key signature,
   checks `activations < max_activations`, records the activation, returns an **activation token** =
   signed(`fingerprint` + license claims).
3. **Offline verification forever.** Each launch: verify the activation token's signature with the
   baked-in public key **and** that its fingerprint matches this machine — fully offline. Store the
   token via Electron `safeStorage` (tamper-evident anyway, being signed).
4. **Opportunistic revocation.** When online, re-validate with a 30–60 day grace; a refunded/revoked
   key dies within weeks on connected machines; offline users are never punished.

### Device limits, drift, revocation

Policy is in doc 05 (2–3 activations; fingerprint drift = new activation, not fraud; self-serve
deactivation; grace before nagging). Implementation: enforce the count **server-side at activation
only** — the sole moment the server is in the loop.

---

## 2. alidade — scope, contracts, stack

**Entire v1 surface: ~5 endpoints + a webhook** (doc 05). Obsidian-shaped, not Notion-shaped.

| Endpoint | Body → returns | Notes |
|---|---|---|
| `POST /webhooks/paddle` | payment event → mint + email license | verify provider signature; **idempotent on event id** |
| `POST /activate` | `{key, fingerprint}` → `{activationToken}` | enforce `max_activations`; on limit → error offering deactivation |
| `POST /deactivate` | `{key, fingerprint}` → `{ok}` | frees a slot; self-serve |
| `POST /validate` | `{activationToken}` → `{valid, revoked, graceUntil}` | opportunistic revocation path |
| `GET /updates/:platform/:version` | → update manifest or `204` | electron-updater feed; artifacts on Cloudflare R2 |

**Data model (Postgres + Drizzle):** `customers`, `licenses` (id, customer_id, edition,
max_activations, issued_at, status, revoked_at), `activations` (id, license_id, fingerprint,
activated_at, last_seen_at, deactivated_at). No user content anywhere.

**Stack (doc 05, D10):** Express + TypeScript + Drizzle + **Supabase as managed Postgres** (decided
2026-07-07 over Neon — Polaris platform fluency + GoTrue option value for v2 identity; SDK never
enters clients), Docker, GitHub Actions, deployed Fly.io/Railway-class. Load at 10k customers ≈ a
few requests/minute; ~$20/mo. **Repository blueprint** (bootstrap, layers, modules, growth path):
[`ALIDADE-SPEC.md`](ALIDADE-SPEC.md).

**Shared with the app (ADR-0003):** the token verification (~20 lines) and API types — **deliberate
duplication**, each side commenting its twin; extract a private package only if it grows. If §6
picks `jose`, both sides simply depend on `jose`.

---

## 3. What alidade does NOT do (the boundary)

| Concern | Home | Why |
|---|---|---|
| **Storage** | ❌ license records only | own no content (ADR-0001); graph/index/dialogues stay on-device |
| **Accounts** | ⚠️ activation only, not a data platform (D7) | "login" = validate license + enable updates; no hosted identity |
| **Inference** | ❌ not alidade at all | BYOK cloud / local Ollama (ADR-0004); a managed-AI tier is post-revenue, separate, license-anchored |
| **Updates** | ✅ `GET /updates` + R2 | the one server-side product feature besides licensing |
| **Settings** | ❌ local only | electron-store / `.astrolabe/` / `safeStorage`; no sync backend in v1 (D11) |

---

## 4. Update & release pipeline

Tag in `astrolabe` → GitHub Actions builds (electron-builder, per the existing `electron-builder.yml`),
**signs + notarizes** (Apple Developer ID; Windows cert), publishes artifacts + manifest to
**Cloudflare R2** (zero egress) → installed apps pull the feed via electron-updater. This is the
Phase-6 completion of the packaging already wired in Phase 0 (unsigned local builds today — config in
`electron-builder.yml`, documented in docs/07 as-built notes). This phase adds signing, the updater
feed, and the CI build matrix.

---

## 5. Anti-piracy layers (do-now vs defer vs never)

The honest split (doc 05 §anti-piracy). **"Stopping" cracking is not the goal — making it cost more
than paying, and making cracked copies decay, is.**

**Do (cheap, highest-leverage):**

1. **Ed25519 signed keys/tokens** — closes forging permanently (§1).
2. **Code signing + notarization** — a patched build loses your signature; the cracker must strip and
   re-sign, and Gatekeeper/SmartScreen warn hard.
3. **Electron ASAR integrity + Fuses** (`@electron/fuses`): `EnableEmbeddedAsarIntegrityValidation` +
   `OnlyLoadAppFromAsar` on; `RunAsNode` + `EnableNodeCliInspectArguments` off. Modifying app code
   breaks the signed asar hash → the app refuses to start; also blocks `ELECTRON_RUN_AS_NODE`/
   `--inspect` injection.
4. **Structural teeth — the real deterrent:** cracked copies can't reach alidade, so **no updates**;
   a fast release cadence makes stale cracked builds self-punishing. Any future cloud service
   re-anchors to a legit license automatically.

**Defer (only if piracy proves material):**

5. **Bytecode the check module** (`bytenode`) or a native addon — no plaintext JS at the check site.
6. **Scatter checks** — verify at launch, export, connector start; not one `validateLicense()` a
   grep finds.

**Never (backfires — punishes real buyers):** always-online DRM / continuous call-home; aggressive
anti-debug / VM detection; any scheme where a fingerprint-drift false-positive can brick a paying
customer. A bricked legit install is a 1-star review; a cracked copy is a non-customer who never paid.

**The real moat (doc 05):** be cheap, excellent, and frictionless to buy — price fairly, activate
instantly, allow 2–3 devices, self-serve deactivation, treat student piracy as deferred marketing.

---

## 6. Open decisions (resolve before building alidade)

- **D-COM-1 — Build vs. buy the licensing backend** *(the decision that reshapes this whole spec):*
  - **Self-build** (current doc-05 plan): full control, ~20-line Ed25519 core, résumé value (D10);
    you own revocation + drift edge-cases.
  - **Lemon Squeezy** (a doc-05 alternative): merchant-of-record **with a built-in License API**
    (activate/validate/deactivate, keys auto-issued) — **shrinks alidade to just the update feed.**
    Highest leverage.
  - **Keygen** (keygen.sh): purpose-built, self-hostable, offline signed-license model = exactly §1;
    buy the model without writing it.

  Recommendation (principle 12, buy hard problems): if MoR = Lemon Squeezy, take its License API and
  keep alidade minimal; self-build only if building it is itself a goal — then scope to the ~20-line
  core.
- **D-COM-2 — Token format:** raw `crypto.sign` payload vs **`jose` EdDSA JWT** (recommended:
  standard, tested, shared trivially app↔alidade).
- **D-COM-3 — Payment provider / MoR:** Paddle vs Lemon Squeezy (couples to D-COM-1). A solo dev must
  not be the merchant (doc 05).
- **D-COM-4 — Pricing points:** the Sublime/JetBrains hybrid shape is chosen (perpetual + N years
  updates, discounted renewal); exact points decided at launch (doc 05 §pricing).
- **D-COM-5 — Activation-token storage:** `safeStorage` (encrypted) vs plain electron-store (token is
  signed either way).

## Non-goals (recorded so they stay deferred)

Hosted accounts / identity platform (D7); cloud storage of user content (ADR-0001); reselling
inference / managed-AI tier (ADR-0004, post-revenue only); hosted `.astrolabe` sync (D11,
post-revenue); Mac App Store / Microsoft Store distribution (sandboxing conflicts with the
connectors); any anti-piracy in the "never" list above.

---

*Analysis-driven and pre-implementation. When Phase 6 begins, resolve §6, create the `alidade` repo,
and turn §§1–5 into a task-by-task plan (superpowers:writing-plans) executed under TDD (ADR-0006) —
licensing verification is Tier-A, test-first.*
