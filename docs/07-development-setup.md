# 07 — Development Setup

**Status:** Living document — tracks current repo state · **Date:** 2026-07-07

## Current repo state (2026-07-07)

The repo was created via WebStorm's New Project dialog (Vite generator → React → TypeScript) at
`~/WebstormProjects/astrolabe`. The `react-ts` scaffold landed as the `initial commit` (`a1c5f45`);
the founding docs, then the engineering-principles + ADR set, followed. The **Electron graft has now
landed** (see "Scaffold sequence" below): the renderer moved into `src/renderer/`, `src/main/` and
`src/preload/` were added, and `pnpm dev`/`pnpm build`/`pnpm start` run a real, verified-booting
desktop app on electron-vite. Cross-platform packaging is also wired: `pnpm package:{mac,win,linux}`
produce per-device installers (each built on its own native machine, unsigned for now). The **test
harness has landed** (INFRASTRUCTURE-SPEC Pillar 1): Vitest (no placeholder specs — first real unit
tests arrive with the first Tier-A logic) and a four-assertion Playwright-for-Electron launch smoke
(`pnpm test:e2e`), which caught and fixed its first real bug on first run (root-absolute
public-asset paths 404ing under `file://` in the built app). **Pino logging is in** (Pillar 2 —
`moduleLogger('…')` children; JSON file sink at `userData/logs/main.log`; pretty stdout dev-only).
**The database foundation is in** (Pillar 3 — `~/Astrolabe/.astrolabe/index.db`, WAL, fail-fast
DB→IPC→window boot, typed table-client over `db:query`, migrations committed + shipped via
extraResources; integration tests run vitest under Electron-as-node for ABI parity).

**Runway steps 3–6 have landed** (see the [runway spec](specs/2026-07-09-runway-to-library-lens.md)
statuses): index schema v1 with the SHA-256 cross-source join, Zotero + Eagle connectors (live-
verified: 152 docs/309 annotations + 900 docs into the real index; `pnpm sync:live`), and the
Library Lens v0 (search + snippets + deep links + Sync/Rebuild). Known limitation recorded: Eagle
file hashing requires disk access to the iCloud library path (TCC) — grant Full Disk Access to the
app/terminal for cross-source joins. Next: MCP server (step 7) + Obsidian connector (step 8).

## Scaffold sequence

Per D13, the renderer comes from the standard Vite template (done) and Electron is grafted as its
own reviewable commit — never a phantom config (the iteration-1 failure).

```bash
cd ~/WebstormProjects/astrolabe

# Electron graft (its own commit):
pnpm add -D electron electron-vite electron-builder
# - move renderer code into src/renderer/
# - add src/main/index.ts (BrowserWindow, secure defaults, boot order) and src/preload/index.ts
# - add electron.vite.config.ts (main/preload/renderer targets)
# - update package.json main field + scripts (dev/build/package)
git add -A && git commit -m "feat: electron shell (electron-vite three-target structure)"
```

Secure defaults, non-negotiable (carried from iterations 2/3): `contextIsolation: true`,
`nodeIntegration: false`, contextBridge-only API surface, boot order DB → IPC → window with
fail-fast quit. The main process also denies outbound navigation (`setWindowOpenHandler` → open in
the OS browser), and the preload throws if `contextIsolated` is false rather than leaking onto the
global.

**As-built notes (2026-07-07 graft):**

- **Versions:** Electron 43, electron-vite 5, Vite 8, React 19.2, TypeScript 6, Node 24 — all via
  **pnpm** (enabled through corepack). The renderer is `src/renderer/` (root), entries auto-detected
  by electron-vite; `out/{main/index.js, preload/index.mjs, renderer/}` is the build output
  (gitignored).
- **`sandbox: false` (with `contextIsolation: true`).** A sandboxed preload must be CommonJS; the
  ESM preload electron-vite emits (`index.mjs`) throws "Cannot use import statement outside a module"
  under sandbox. `contextIsolation` — not `sandbox` — is the load-bearing renderer control, so the
  graft runs `sandbox: false` (also the official electron-vite template's posture). Full OS
  sandboxing is a future hardening step needing a CJS-emitted preload; take it via its own ADR.
- **`pnpm-workspace.yaml` → `allowBuilds`.** pnpm 11 fails closed on undecided install scripts;
  `esbuild: true` (needs its platform binary), `electron-winstaller: false` (Windows-only).
- **CSP warning in dev is expected** — it disappears when packaged (verified: the packaged mac
  `.app` boots with a clean log, no CSP warning); enforce+nonce CSP is a deploy-time task (mirrors
  the Polaris layer-8 posture).
- **Packaging (electron-builder):** one `electron-builder.yml` drives all platforms; each is built
  on its own native machine — `pnpm package:mac` (dmg + zip), `pnpm package:win` (nsis),
  `pnpm package:linux` (AppImage), or `pnpm package:dir` for a fast unpacked `.app` while iterating.
  macOS development builds use the stable `Astrolabe Dev` signing identity from the login keychain;
  distribution signing/notarization remains Phase 6. `asarUnpack: '**/*.node'` and electron-builder's per-device
  `@electron/rebuild` are durable prep for Phase 2's better-sqlite3 (the ABI-mismatch fix); the
  `postinstall: electron-builder install-app-deps` dev-side rebuild hook enters with that native dep.
  The electron-updater feed (+ Cloudflare R2) and a CI build matrix also remain Phase 6.

### TCC-stable macOS development install

Use `pnpm dev:install:mac` when testing connectors that need protected filesystem access. It builds
and signs the unpacked app, verifies its bundle ID and designated requirement, safely replaces
`/Applications/Astrolabe.app`, registers it with Launch Services, and relaunches it. Keeping both
the installed path and signing requirement stable allows macOS privacy grants to survive rebuilds.

The command refuses to replace an existing app when the signing identity changes. For an intentional
certificate migration, run it once with `ASTROLABE_ALLOW_IDENTITY_CHANGE=1`; macOS permissions must
then be granted again. `pnpm dev` remains the fast renderer/main-process loop, but its Electron host
is not the binary to use for TCC-sensitive testing.

WebStorm exposes matching project run configurations: **Astrolabe Dev (HMR)** for the normal fast
loop and **Astrolabe Installed (macOS/TCC)** for the signed application update. The latter delegates
to the macOS-guarded package script, so it exits without changing anything on another operating
system.

### Native module note

`better-sqlite3` must be rebuilt against Electron's Node ABI. electron-vite's
`externalizeDepsPlugin` + electron-builder's postinstall rebuild handle it — solved once in the
alidate iteration; same solution applies.

## WebStorm configuration

- **Open the repo root** (File → Open) — equivalent to wizard-created projects; indexing, run
  configs, refactoring all work identically
- Settings → Languages & Frameworks → **Node.js → Package manager: pnpm**
- Settings → TypeScript → use the **workspace TypeScript** version
- ESLint: automatic configuration (flat `eslint.config.js`)
- Run configurations: npm-type config for the `dev` script; commit `.idea/runConfigurations/` if
  sharing configs is wanted
- Debugging: main process via Node run config with `--inspect`; renderer via Chromium DevTools
  inside the app (⌥⌘I)

## Repository conventions

The full operating principles and their rationale live in
[10 — Engineering Principles](10-engineering-principles.md); irreversible choices live in the
[ADRs](adr/). This section is the concrete repo-conventions checklist — each rule traces to a
recorded mistake in the audit's failure catalog:

1. **No aspirational docs.** README and docs describe what exists. (Iteration 3's README described
   BLOB storage and content hashing that never existed.)
2. **No committed artifacts.** No compiled `schema.js`, no `coverage/`, no generated `docs/`, no
   `.env` (iteration 3 committed all four). `.gitignore` from day one; verify nothing runtime-needed
   is ignored (iteration 2 gitignored its own migrations while bundling them).
3. **One name per concept.** Glossary: Astrolabe (app), Alioth (agent harness), Orion (knowledge
   engine), alidade (licensing API), connector, index, node/edge, provenance, View (saved lens),
   Dialogue. UI labels match code
   identifiers. (Iteration 1: `Note` in code, "View" in UI, `NoteEditor` rendering Excalidraw.)
4. **No god components.** The reader/graph/dialogue surfaces are composed; a file approaching ~300
   lines is a design smell to address, not a habit to continue. (Iteration 1: 1,963-line
   `DocumentViewer.tsx` with ~40 useState.)
5. **Explicit modeling.** No magic strings for states (iteration 3's `'trash'`); soft-delete via
   schema (`deletedAt`/status enum); stable IDs, content-hash (SHA-256) where identity matters —
   never `crypto.randomBytes` labeled "hash", never filename identity.
6. **Testing per test altitude** ([ADR-0006](adr/0006-test-altitude.md), aligned with the user's
   global standard): failing test first for anything that branches, transforms, or enforces a rule,
   and anything security/data/license/token-bearing — connectors' parsing, graph operations, the
   context assembler, license verification. No tests for design tokens, copy, config, or one-line
   wrappers; no change-detector tests. No test-config theater (iteration 2 had coverage tooling and
   zero real tests); no 4k-line test suites on one layer while the UI ships untested (iteration 3).
7. **Commits small and descriptive**; the Electron graft pattern generalizes — infrastructure
   changes land as their own reviewable commits.
8. **`CLAUDE.md`** adapted from alidate's `AI_BEST_PRACTICES.md`: no `any`, ESM-only, error-context
   rules, review checklist — updated for this architecture.
9. **Documentation dating & naming.** Numbered docs (`NN-*.md`) and ADRs carry a `**Status:** … ·
   **Date:** YYYY-MM-DD` header and stand alone; "Living document" marks ones that track changing
   state (this doc, the roadmap, the principles). **ADRs** are sequence-numbered
   (`adr/NNNN-slug.md`) with the date inside — the number is the identity you cite (`ADR-0006`).
   **Dated implementation specs and plans** (point-in-time working documents, not a monotonic
   ledger) are date-prefixed (`docs/specs/YYYY-MM-DD-slug.md`). **Living project-level specs** — the
   durable kind that track ongoing infrastructure (e.g. root `INFRASTRUCTURE-SPEC.md`) — sit at the
   repo root with a `Status: Living` header, alongside the README/ADR canon. (Convention mirrored
   from the sibling Polaris project, whose root carries topic specs too.)

## Port-in checklist (from the salvage manifest)

Copy deliberately, with tests, when the phase calls for it — not preemptively:

| When | What | From |
|---|---|---|
| Phase 0 | Strict tsconfigs; typed IPC/table-client pattern; Pino setup; secure main-process boilerplate | `~/Desktop/astrolabe/astrolabe/` and `alidate-astrolabe-current/astrolabe/` |
| Phase 1 | `.astro` bundle → `.astrolabe/` manifest concepts; import-vs-reference semantics (for ink) | `alidate .../electron/settings.ts`, `LocalFileService.ts` |
| Phase 2 | M:N junction patterns + operations-layer test discipline | `alidate .../src/db/operations/` |
| Phase 5 | `buildPageMap`, `findTocPathsForPages`, TOC path addressing, lazy thumbnails, pdf.js worker wiring | `astrolabe-main/src/components/DocumentViewer.tsx` (lines ~349, ~672, ~990, 8–11) |

## Environment facts

- macOS (darwin 25.4), zsh, pnpm, WebStorm primary IDE
- Zotero desktop with patched keyless local API access (zotcli setup) — the Zotero connector's
  proving ground
- Eagle desktop with localhost:41595 API — the Eagle connector's proving ground
- Syncthing in use — the zero-backend multi-device story (D11) is testable from day one
- Ollama installed — local-model path testable from day one
