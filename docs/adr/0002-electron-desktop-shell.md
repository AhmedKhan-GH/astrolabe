# ADR-0002: Electron is the desktop shell — final

**Status:** Accepted
**Date:** 2026-07-07

## Context

Iteration 1 (`astrolabe-main`) thrashed on the shell decision: git history shows
`working electron distributable` → `before tauri` → `removed electron` → `fixed resizing issues and
removed electron`. The desktop shell was built, doubted, and torn out, leaving a working tree that
**did not build** and a `package.json` still declaring `"main": "electron/main.js"` against a
directory that did not exist — a *phantom* desktop app. Shell indecision, not any technical wall, is
what stalled that iteration.

## Decision

**Electron is the desktop shell. Final.** This is an ADR-level commitment: it is not relitigated
without a real, in-tree blocker (not taste, not a new framework's launch post).

Rationale beyond stopping the thrash: native-module support for `better-sqlite3`; a consistent
Chromium for the v2 pdf.js reader; existing team fluency; `electron-builder` known from the mature
prior iteration. (Design decisions D8, D13; Tech Stack doc.)

The graft is an **explicit, immediate step**, never a phantom config: the renderer comes from the
WebStorm Vite → React → TS wizard, and Electron is added as its own reviewable commit
(`electron-vite` three-target `src/{main,preload,renderer}`), because "add Electron later" without
actually wiring it is precisely how iteration 1 shipped a shell that did not exist.

## Consequences

- Secure defaults are non-negotiable and carried from the prior iterations: `contextIsolation: true`,
  `nodeIntegration: false`, contextBridge-only surface, boot order DB → IPC → window with fail-fast
  quit (see [07 — Development Setup](../07-development-setup.md)).
- `better-sqlite3` must be rebuilt against Electron's ABI — solved once already
  (`externalizeDepsPlugin` + electron-builder rebuild); the solution is ported, not rediscovered.
- **Rejected — Tauri:** relitigated once already at the cost of a broken tree; WebView inconsistency
  for PDF rendering and native-module friction. Dead. **Rejected — pure web:** contradicts local-first
  (browser storage was iteration 1's storage-vs-vision contradiction).
- To revisit would require a concrete Electron blocker this product actually hits — none is known.
