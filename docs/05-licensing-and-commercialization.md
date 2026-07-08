# 05 — Licensing & Commercialization

**Status:** Current — founding design session; pricing points deferred to launch · **Date:** 2026-07-07

> This document owns the commercial **model and policy**. The implementation build plan — crypto,
> endpoint contracts, the app-side seam, anti-piracy layers, and the build-vs-buy decision — lives in
> the root [`COMMERCIALIZATION-SPEC.md`](../COMMERCIALIZATION-SPEC.md).

The commercial model is the **Eagle.cool model**: pay once, get a license key, the software runs
forever on-device; the server exists only to mint, activate, and count licenses. Optional cloud
services, if they ever exist, are billed separately. This chapter records the full mechanics as
designed, including the honest limits of anti-piracy.

## Why this model fits

- The product runs entirely on-device (index, graph, Alioth, connectors all local)
- AI is BYOK or local Ollama (D5) — Astrolabe never resells inference, so there is no per-use cost
  to recover
- Login is license activation only (D7) — no accounts platform, no hosted data
- The reference companies (Eagle, and structurally Obsidian) prove a tiny team can run this shape
  profitably

## License lifecycle

### 1. Purchase → key issuance

Customer buys on the website via **Paddle** (merchant of record — Paddle is legally the seller,
handles global sales tax/VAT/invoices; as a solo developer, do not be the merchant). Paddle fires a
webhook to alidade, which generates the license:

- Payload: `license_id`, customer email, edition, `max_activations`, issue date
- Signed with the **Ed25519 private key**, which exists only on the server
- Delivered by email and on-screen

### 2. Activation → device binding

Customer pastes the key into Astrolabe. The app computes a **machine fingerprint** (stable hardware
identifiers, hashed — the `node-machine-id` approach) and calls alidade with `key + fingerprint`.
If the license is valid and under its activation limit, alidade records the activation and returns
an **activation token**: a payload containing that machine fingerprint, again signed with the
server's private key.

### 3. Offline verification forever

The app ships with the **Ed25519 public key baked in**. On every launch it verifies — entirely
offline — that the activation token's signature is valid and its fingerprint matches the current
machine. No phoning home, no internet requirement. This is what makes "runs on your device, we
can't take it away" an honest promise rather than marketing.

### 4. Device limits

"How many devices" is enforced **server-side at activation time** — the only moment the server is in
the loop. Policy decisions recorded:

- Allow **2–3 activations** (Eagle allows 2). Exactly-one punishes people who buy a new laptop.
- Hardware fingerprints **drift** (OS reinstalls, board swaps change them) — treat drift as a new
  activation request, not fraud.
- Activating past the limit offers **self-serve deactivation** of an old machine ("deactivate old
  MacBook?") — a web page + an endpoint, keeping support load near zero.

### 5. Revocation (refunds, chargebacks, leaked keys)

The app re-validates with alidade **opportunistically when online**, with a generous grace period
(30–60 days) before nagging, and never hard-locks a machine that is genuinely offline. A refunded
or revoked key dies within weeks on connected machines; offline users are never punished.

## Anti-piracy: the honest position

**No scheme prevents cracking, and "cannot be jailbroken" is the wrong target.** The app runs on
hardware the attacker owns; an Electron app is shipped JavaScript; a determined cracker patches
`if (licenseValid)` to `true`. This is equally true of Eagle, Sublime Text, and Obsidian — cracked
versions of all of them exist, and all are profitable anyway.

The cryptography and the crack-resistance solve **different problems**:

- **Ed25519 signatures make forging keys impossible** — nobody can mint valid licenses without the
  server's private key. This problem is fully solved.
- **Nothing makes patching the checking code impossible.** This problem is only made more expensive.

Layered mitigations that raise the cost enough to deter casual sharing (and then stop):

1. Compile the license module to **V8 bytecode** (bytenode) or a **native Node addon** — no readable
   JS at the check site
2. **Electron ASAR integrity fuse** + code signing — the app refuses to start if its bundle is
   modified
3. **Scatter checks** — verify at launch, at export, at connector start; not one function with an
   obvious name
4. **Structural teeth (the ones that matter):** cracked copies cannot talk to alidade, so they get
   **no updates** — a fast-moving app makes stale copies self-punishing. Any future optional cloud
   service (hosted sync, managed AI tier) re-anchors to legitimate licenses automatically and is
   billed separately.

Then stop. The economics, recorded: losses come from people who would never have paid; every
additional DRM layer risks false positives against paying customers (a fingerprint-drift brick of a
legitimate install is a one-star review; a cracked copy is a non-customer). Eagle's real moat is not
its DRM — it is being cheap, excellent, and frictionless to buy, making cracking more work than
paying. Price fairly, activate instantly, allow 2–3 devices, and treat student piracy as deferred
marketing.

## Pricing structure (decision deferred, constraint recorded)

A pure "lifetime license" carries an obligation of lifetime updates against real ongoing costs
(signing certs ~$300–500/yr combined, R2, development time). The **Sublime/JetBrains hybrid** is the
recommended shape: **perpetual license including 1–3 years of updates, then a discounted renewal for
future updates** — keeps the "it's yours forever, runs on your device" promise while making revenue
recurring enough to sustain development. Eagle's flat-lifetime works partly because their release
pace is glacial. Final price points: decide at launch; not a v1 blocker.

## Alidade's complete scope (v1)

Approximately five endpoints plus a webhook — deliberately Obsidian-shaped, not Notion-shaped (D12):

| Endpoint | Purpose |
|---|---|
| `POST /webhooks/paddle` | Purchase events → mint license, email key |
| `POST /activate` | key + fingerprint → activation token (enforces limit) |
| `POST /deactivate` | Self-serve device release |
| `POST /validate` | Opportunistic re-check (revocation path) |
| `GET /updates/:platform/:version` | electron-updater feed (or static R2 manifest) |

Stack: Express + TypeScript + Drizzle + managed Postgres (Neon/Supabase), Docker, GitHub Actions,
deployed anywhere cheap (Fly.io/Railway class). Load profile at 10,000 customers: a few requests per
minute. Total cloud footprint before customers: ~$20/month.

**The alidade repo is created on the day this phase begins — not before.** Iteration 4's alidade sat
as a 13-line hello-world for three months; the seam-before-the-need mistake is recorded in the audit
and shall not recur.

## Update & release pipeline

1. Tag a release in `astrolabe`
2. GitHub Actions: build (electron-builder), rebuild native modules, **sign** (Apple Developer ID +
   notarization; Windows cert), publish artifacts + update manifest to **Cloudflare R2**
3. Installed apps check the update feed (electron-updater); licensed apps update seamlessly

## Distribution surface

- **Website** (Astro, Cloudflare Pages/Vercel): landing, docs, Paddle checkout, license management
  (self-serve deactivation), downloads
- Direct download only at launch; Mac App Store / Microsoft Store deliberately out of scope
  (sandboxing conflicts with connectors reaching Zotero's database and localhost APIs)
- **PostHog** (opt-in) for feature usage; **Sentry** (opt-in) for crashes
