# 04 — Tech Stack

**Status:** Current — founding design session · **Date:** 2026-07-07

Optimized for two constraints simultaneously: correct for the product, and maximally recognizable
industry-standard names (résumé value was an explicit selection criterion). Every choice below is
final unless a real blocker appears; relitigating the stack was a failure mode of prior iterations.

## Desktop app (`astrolabe` repo — this repo)

| Concern | Choice | Rationale |
|---|---|---|
| Language | **TypeScript**, strict everywhere | Baseline. Port the alidate tsconfig discipline (`strict`, `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`; consider `noUncheckedIndexedAccess`) |
| UI framework | **React 19** | Industry default; all prior iterations used it |
| Desktop shell | **Electron** | Final (ADR-level decision). Native module support for better-sqlite3, consistent Chromium for the v2 pdf.js reader, existing fluency. The Electron→Tauri→web thrash of iteration 1 is the counterexample on record. |
| Build | **Vite** via **electron-vite** | Three-target structure (`src/main`, `src/preload`, `src/renderer`) with HMR for renderer and auto-restart for main. The JetBrains wizard supplies only the renderer half (Vite → React → TS); Electron is grafted as an explicit second commit (D13). |
| Packaging | **electron-builder** | Known from alidate; handles native-module rebuilds, signing, publish targets |
| Styling | **Tailwind CSS 4** + **shadcn/ui** | Tailwind carried from alidate; shadcn prevents another 900-line hand-written CSS file |
| Client state | **Zustand** | The modern standard answer; the absence of any state layer was a recorded failure of all four prior iterations |
| Server/IPC state | **TanStack Query** | Caching + invalidation over connector/index data crossing IPC; kills the alidate "reload the window on library switch" hack |
| Database | **better-sqlite3** + **Drizzle ORM** | Proven pairing from two prior iterations; typed `$inferSelect`/`$inferInsert` flowing schema → IPC → React (the salvaged pattern) |
| Full-text search | **SQLite FTS5** | In-engine, zero extra infra |
| Vector search | **sqlite-vec** | Embeddings in the same SQLite file; semantic search without a vector-DB dependency |
| Graph canvas | **Sigma.js** (WebGL) | Graphs will reach thousands of nodes; SVG-based libraries (React Flow, D3-SVG) degrade badly there |
| AI providers | **Vercel AI SDK** | One abstraction over Anthropic / OpenAI / **Ollama** — BYOK and local through the same interface, streaming included (D5) |
| OCR | Vision model via the provider layer; **Tesseract** as local fallback | Keeps OCR inside the same abstraction instead of a parallel pipeline |
| File watching | **chokidar** | Obsidian vault connector |
| Secrets | Electron **safeStorage** (OS keychain) | BYOK keys never touch the DB or config files |
| Logging | **Pino** | Carried from alidate, with its structured-context conventions |
| Crash/errors | **Sentry** (opt-in) | |
| Testing | **Vitest** + Testing Library + **Playwright for Electron** | Unit/component + real E2E. Per the user's global TDD rule: failing test first for anything that branches, transforms, or enforces a rule; no change-detector tests |
| Lint | ESLint 9 flat config + typescript-eslint | Carried from prior iterations |
| PDF (v2) | **pdf.js** (`pdfjs-dist`), text layer enabled | Text selection is the prerequisite for highlights, extraction, and search — its absence was the ceiling of the iteration-1 viewer. Worker wiring pattern already solved (salvage manifest). |

## Backend (`alidade` repo — created only at the commercialization phase)

| Concern | Choice | Rationale |
|---|---|---|
| Runtime | **Node.js + TypeScript** | Same language as the app; the Notion precedent (D12) |
| Framework | **Express** | D10: the most recognized backend framework in existence; at ~5 endpoints + a webhook, framework choice is aesthetic, so take the résumé-standard. (Fastify equally acceptable; Hono was the original recommendation, dropped for name recognition; NestJS overkill; **distributed Go explicitly rejected** — 10k customers ≈ a few requests/minute.) |
| Database | **PostgreSQL**, managed (**Neon** or **Supabase** — interchangeable here) | Licenses, activations, customers. Free tiers carry to revenue. Supabase's client SDK/auth do NOT enter the desktop app (D11). |
| ORM | **Drizzle** | Shared knowledge with the app |
| Payments | **Paddle** (or Lemon Squeezy) as **merchant of record**; Stripe + Stripe Tax the résumé-name alternative | MoR = they are the seller; global sales tax/VAT handled; never touch card data. Solo dev must not be the merchant. |
| Licensing | **Ed25519-signed keys + activation tokens** | Full mechanics in [05](05-licensing-and-commercialization.md) |
| Updates | **electron-updater** + **Cloudflare R2** | R2 has zero egress fees; installers are large |
| Signing | Apple Developer ID + notarization; Windows code-signing cert | Unsigned Electron is dead on arrival; budget ~$100/yr Apple, ~$200–400/yr Windows |
| Containers | **Docker** | Baseline |
| CI/CD | **GitHub Actions** | Build → sign → notarize → publish to R2 on tag |
| Website | **Astro** on Cloudflare Pages/Vercel with Paddle checkout | Marketing only; no app logic |
| Analytics | **PostHog**, opt-in | |

## Repository structure (D9)

**Two separate repositories** (user decision; monorepo recommendation recorded and declined):

- `astrolabe` — this repo: the Electron app, all product code, these docs
- `alidade` — created on the day commercialization work begins, not before (the empty-Express-repo
  lesson from iteration 4)

Shared surface between them: the Ed25519 activation-token verification (~20 lines against a stable
spec) and the API request/response types. Handled by **deliberate duplication**, kept in sync by
convention (each side carries a comment pointing at its twin); extract a tiny private npm package
only if it grows. This duplication is a recorded decision, not an accident.

## The stack in one line

> TypeScript — Electron/React/Vite desktop app with SQLite (Drizzle, FTS5, sqlite-vec), Zustand +
> TanStack Query, Sigma.js, Vercel AI SDK (BYOK + Ollama); Express/PostgreSQL licensing API with
> Paddle payments, Docker, GitHub Actions, Cloudflare R2; Vitest + Playwright throughout.

## Rejected alternatives (recorded verdicts)

- **Tauri** — relitigated once already at cost of a broken tree; WebView inconsistency for PDF
  rendering, native-module friction. Dead.
- **Go / distributed backend** — order-of-magnitude overkill for the load profile (D10). If Go for
  taste, fine at this size — but TypeScript keeps one language and shared types. Distributed
  topology of any kind: dead until the numbers demand it.
- **Hono / Fastify / NestJS** — all viable; Express chosen for recognition (D10).
- **PowerSync / ElectricSQL / Turso replicas / Rocicorp Zero / CRDTs (Yjs, Automerge)** —
  architecturally inverted for this product: they replicate a cloud source of truth to devices;
  Astrolabe's sources of truth are already on the device and the index is rebuildable (D11). Only
  future role: hosted E2E-encrypted sync of `.astrolabe/` artifacts, post-revenue, and even then
  blob-sync (Obsidian Sync model) likely beats row replication.
- **Supabase as app backend / auth** — no. Managed-Postgres-for-alidade only.
- **Prisma** — Drizzle chosen for consistency across both repos and better fit with better-sqlite3;
  Prisma noted as the higher-recognition name if that ever matters in an interview.
- **Redux** — Zustand chosen; Redux only as a legacy keyword.
- **Monorepo (pnpm + Turborepo)** — recommended, declined by user; two repos (D9).
