# 07 — Development Setup

## Current repo state (2026-07-07)

The repo was created via WebStorm's New Project dialog (Vite generator → React → TypeScript) at
`~/WebstormProjects/astrolabe`. The `react-ts` scaffold is in place as the `initial commit`
(`a1c5f45`): standard Vite layout (`index.html`, `src/`, `vite.config.ts`, three tsconfigs, ESLint
flat config). These docs are the second commit. Next action: the Electron graft.

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
fail-fast quit.

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
