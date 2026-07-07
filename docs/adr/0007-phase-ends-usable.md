# ADR-0007: Every roadmap phase ends with something personally usable

**Status:** Accepted
**Date:** 2026-07-07

## Context

The single cause of death shared by all four prior iterations (audit, doc 01) was **infra before
features**: every iteration built plumbing — multi-DB switching, a service factory, remote HTTP
stubs pointing at a nonexistent API, 4k lines of folder tests, an empty Express backend — and none
built product value. Iteration 3's own audit verdict: *"Enormous energy went into infra while zero
core product value was built. The 80/20 was inverted. Imported files could not even be opened
in-app."* The plumbing was often good; it was just never in service of a shipped capability.

## Decision

**Sequencing law: every roadmap phase ends with something the builder personally uses that week.**
Infrastructure exists only in service of the phase it ships in; a seam is built the phase it is
first consumed, never before. (Roadmap doc; this is the ordering that makes Phases 0–6 load-bearing.)

Corollaries, each traced to a recorded mistake:

- The `alidade` backend is created at Phase 6, not earlier (ADR-0003; iteration 4's three-month
  hello-world).
- The Electron graft is its own reviewable commit that actually wires the shell (ADR-0002;
  iteration 1's phantom config).
- Salvaged code is ported **when its phase calls for it, with tests — not preemptively** (salvage
  manifest, doc 01).
- The "Rebuild index" action ships in Phase 1 to prove ADR-0005 from the start.

## Consequences

- Each phase is independently a daily-driver improvement: Phase 1 (unified library search) is usable
  before any AI exists; Phase 2 (the graph) before Alioth; and so on. If a phase ends and the builder
  does not actually use it that week, that is the signal to stop and reconsider — before investing in
  the next layer.
- **Cost:** forbids the satisfying up-front build-out of a general framework; abstractions must earn
  their place by a present consumer (see [10 — Engineering Principles](../10-engineering-principles.md),
  "build on consumption, not speculation").
- **Never:** a speculative seam (iteration 3's local/remote `ServiceFactory` against an API that did
  not exist) shipped ahead of the feature that needs it.
