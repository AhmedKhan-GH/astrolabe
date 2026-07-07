# ADR-0003: Two separate repositories; alidade created only at commercialization

**Status:** Accepted
**Date:** 2026-07-07

## Context

A pnpm + Turborepo monorepo (`apps/astrolabe`, `apps/alidade`, `apps/web`, `packages/shared`) was
recommended in the design session for one real reason: shared license-verification code and API
types between the app and its licensing backend. Against that: iteration 4's `alidade` was a 13-line
Express hello-world that sat unchanged for **three months** — the canonical lesson in standing up a
seam before the need.

## Decision

**Two separate repositories, no monorepo:**

- `astrolabe` — the Electron app, all product code, the docs. (This repo.)
- `alidade` — the licensing/updates API, **created on the day the commercialization phase begins
  (roadmap Phase 6), not before.**

The shared surface — Ed25519 activation-token verification (~20 lines against a stable spec) and the
API request/response types — is handled by **deliberate duplication**: each side carries a comment
pointing at its twin; extract a tiny private npm package only if it ever grows. (Design decisions D9,
D10.)

## Consequences

- The duplication is a **recorded decision, not an accident** — so it is never "discovered" later and
  refactored on reflex. ~20 lines against a stable spec is cheaper to duplicate than to share across a
  monorepo boundary.
- `alidade` does not exist until it earns its existence; iteration 4's empty-repo mistake cannot
  recur.
- **Cost:** if the shared surface grows beyond the activation spec, revisit by extracting a private
  package (not by adopting a monorepo).
- **Rejected — monorepo:** recommended and declined; the shared-code benefit is real but small and is
  bought more cheaply by conscious duplication than by Turborepo wiring for a two-artifact project.
