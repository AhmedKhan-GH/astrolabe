# ADR-0006: Test altitude — TDD rigor scales to stakes × logic

**Status:** Accepted
**Date:** 2026-07-07

## Context

The user's global standard and this repo's conventions both mandate test-first development. A blanket
"TDD everything" rule, however, has a recorded failure mode (observed in the sibling Polaris project,
whose ADR-0010 this adapts): the discipline generalizes from the security/data spine — where it is
load-bearing — into aesthetics, producing **change-detector tests** (a `charCount` test asserting
`'hello'.length === 5`; a stylesheet contrast test re-implementing WCAG math to check hex constants).
Those tests can only fail when someone changes a value on purpose. They tax the very work — theming,
copy, config — they least protect, and they erode trust in the suite.

The prior iterations show both poles of the same waste: iteration 2 had well-configured Vitest +
coverage and **zero real tests** (test-config theater); iteration 3 had ~4k lines of tests on one
folder layer while the entire UI, services, and IPC shipped **untested**.

## Decision

TDD rigor is **not uniform; it scales to stakes × logic.** Before writing a test, two questions set
the mode:

1. **Stakes** — if this is silently wrong in production, what breaks? A breach / data loss / money or
   license error, vs. a user-visible glitch, vs. something cosmetic.
2. **Logic** — does it branch, transform, or enforce a rule? Or is it a constant, a design token, or
   a one-line wrapper over the standard library?

Three tiers follow:

- **Tier A — iron TDD, every warranted tier.** Anything security/data/license/token-cost-bearing and
  any pure rule-enforcing logic: **connector parsing, the graph/index operations, provenance
  resolution, the context assembler's retrieval, Ed25519 license verification, the salvaged
  `buildPageMap`/`findTocPathsForPages` algorithms.** Test-first, red → green → commit, at the tiers
  the risk warrants (unit + integration; E2E for user journeys).
- **Tier B — test the behavior; one tier as warranted.** User-visible logic with low blast radius
  (nav/filter visibility, error display, view persistence). Test that it branches correctly;
  test-first or test-after both fine; usually one tier suffices.
- **Tier C — not a red-green subject.** Aesthetics, config, copy, design tokens, stdlib wrappers.
  Reviewed by eye. A single CI *guard* is permitted where regression risk is real, but it is a guard
  written once — never a per-edit driver, never authored test-first per token.

**The decisive filter:** *would this test ever fail for a reason other than someone changing a value
on purpose?* If no, it is a change-detector — do not write it. When genuinely unsure which tier
applies, **ask; do not reflexively test.**

## Consequences

- The Tier-A spine (connectors, index, Alioth retrieval, licensing, port-with-tests algorithms) keeps
  full rigor — this ADR narrows nothing that guards correctness or money.
- No test-config theater (iteration 2) and no lopsided 4k-lines-on-one-layer suites (iteration 3):
  coverage follows risk, not habit.
- TDD-per-commit is a **cultural** rule, deliberately not mechanically enforced — unlike a boundary
  law, there is no linter or scanner for it; it lives on judgment and review.
- This rule is itself reviewable: if a Tier-C guard repeatedly catches regressions eye-review misses,
  promote that specific check. The default — aesthetics are not red-green subjects — stands.
- The global CLAUDE.md rule and this repo's [10 — Engineering Principles](../10-engineering-principles.md)
  and [07 — Development Setup](../07-development-setup.md) **cite** this ADR rather than restating it
  (one fact, one home).
