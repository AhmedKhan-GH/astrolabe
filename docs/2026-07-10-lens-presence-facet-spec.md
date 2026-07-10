# Lens Presence Facet (reconciler, read half) — Design Spec

**Date:** 2026-07-10 · **Status:** approved
**Problem:** the Zotero↔Eagle split is invisible: nothing answers "which PDFs live only in Eagle
(library) and not in Zotero (annotation workspace), or vice versa?" This is the read half of the
reconciler; promote/import gestures land separately once the Zotero write path is spiked.

## Semantics

A new AND-dimension over zotero/eagle instance existence (obsidian is out of scope — notes are
not split-managed):

```ts
presence: z.array(z.enum(['both', 'zotero-only', 'eagle-only'])).max(3).optional()
```

Internal OR like every array dimension. SQL per value over aliased `d` (Z = EXISTS zotero
instance, E = EXISTS eagle instance): `both` = Z AND E · `zotero-only` = Z AND NOT E ·
`eagle-only` = E AND NOT Z. Only documents with at least one zotero/eagle instance ever match
any value (obsidian-only notes match none — correct).

## Wire + renderer

- `filterSetSchema` + `LensSelection` gain `presence`; NOT part of scope — it composes with
  sources/collections by AND (own helper `togglePresence`, or widen toggleScope's union — keep
  whichever reads cleaner, it is NOT OR-composed with scope).
- `NavData` gains `presence: { value, count }[]` (three rows, computed with the same predicates).
- NavRail: "Presence" section (chips with counts) below Kinds. FilterBar chips labelled
  "In both" / "Zotero only" / "Eagle only". StoredFilter passes `presence` through verbatim
  (values are stable).

## Testing

Integration: each value alone (fixture: one doc in both, one zotero-only, one eagle-only, one
obsidian-only), OR of two values, AND-composition with a scope and a tag filter, nav counts.
Unit: selection round-trip with the new dim. Component: rail section + chips render/toggle.
