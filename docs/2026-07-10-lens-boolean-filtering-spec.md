# Lens Boolean Filtering (Track A, step 2) — Design Spec

**Date:** 2026-07-10 · **Status:** approved (surface roadmap, step after lens v1)
**Problem:** the v1 selection model is one value per dimension. Eagle-grade navigation needs
multi-select facets and boolean tag search (ALL / ANY / NONE) — across all three sources at once.

## Semantics

Dimensions compose with **AND**. Within a dimension, selection is a **union (OR)** — with tags
carrying full boolean structure instead:

- **Scope** (one dimension): sources ∪ collections ∪ folders. A document matches if it lives in
  *any* selected source, *any* selected collection, or under *any* selected vault folder. This is
  the checkbox-tree intuition (Eagle multi-folder select shows the union). Cross-presence
  ("in Zotero AND in Eagle") is reconciler territory, not this step.
- **Kinds**: `d.kind IN (…)`.
- **Tags**: `tagsAll` (document has every one), `tagsAny` (at least one), `tagsNone` (none of
  them). All three may be present simultaneously and AND together.

Empty selection = no constraint (browse-all river, unchanged).

## Wire contract

`filterFields` in `src/main/index/queries.ts` is replaced by:

```ts
export const filterSetSchema = z.object({
  sourceKeys: z.array(z.enum(['zotero', 'eagle', 'obsidian'])).max(3).optional(),
  collectionIds: z.array(z.number().int().positive()).max(100).optional(),
  folderPrefixes: z.array(z.string().max(500)).max(50).optional(), // externalKey LIKE '<p>%', obsidian-scoped
  kinds: z.array(z.enum(['pdf', 'image', 'note', 'other'])).max(4).optional(),
  tagsAll: z.array(z.string().max(200)).max(50).optional(),
  tagsAny: z.array(z.string().max(200)).max(50).optional(),
  tagsNone: z.array(z.string().max(200)).max(50).optional(),
})
export type FilterSet = z.infer<typeof filterSetSchema>
```

`searchRequestSchema` = `{ q, limit }` + these fields (spread, all optional — the MCP server's
`{q, limit}` calls remain valid). `browseRequestSchema` = these fields + `{ offset, limit }`.
The v1 scalar fields (`sourceKey`, `collectionId`, `folderPrefix`, `tag`, `kind`) are **removed**,
not aliased — the renderer is the only consumer and updates in the same change.

## SQL (filterConditions rewrite, shared by browse + search verbatim)

Predicates over aliased `documents d`, one-row-per-document (EXISTS, never JOIN+DISTINCT):

- scope (emitted once, ORing only the sub-predicates whose list is non-empty):
  `(EXISTS di+src WHERE src.key IN (sourceKeys) OR EXISTS dc WHERE dc.collection_id IN (collectionIds)
    OR EXISTS di+src WHERE src.key='obsidian' AND (external_key LIKE p1% OR LIKE p2% …))`
- kinds: `d.kind IN (kinds)`
- tagsAll: one `EXISTS (… t.name = ?)` per tag, AND-joined
- tagsAny: `EXISTS (… t.name IN (tagsAny))`
- tagsNone: `NOT EXISTS (… t.name IN (tagsNone))`

## Renderer selection model

```ts
export interface LensSelection {
  sourceKeys: SourceKey[]
  collectionIds: number[]
  folderPrefixes: string[]
  kinds: DocumentKind[]
  tags: { name: string; mode: 'require' | 'exclude' }[]
  tagMatch: 'all' | 'any' // how required tags combine → tagsAll vs tagsAny on the wire
}
```

Pure helpers in `selection.ts` (all unit-tested; `applySelection` is deleted):
`emptySelection()`, `toggleScope(sel, dim, value)`, `toggleKind(sel, kind)`,
`cycleTag(sel, name)` (neutral → require → exclude → neutral), `setTagMatch`, `clearAll`,
`isEmpty(sel)`, `toFilterSet(sel): FilterSet` (require + 'all' → tagsAll; require + 'any' →
tagsAny; exclude → tagsNone; empty arrays omitted).

## UI

- **NavRail**: clicks toggle set membership — no cross-dimension clearing. Selected kinds/
  sources/collections/folders highlight; a tag chip renders neutral / required (✓, accent) /
  excluded (−, struck or red accent). A small "Match all ▾ / any" control appears beside the
  Tags heading once ≥2 tags are required.
- **FilterBar** (new component, above the search input): one chip per active facet value with ×
  to remove, and "Clear all". Renders nothing when the selection is empty. This keeps selections
  made in collapsed tree nodes visible and reversible.
- **Lens.tsx**: holds `LensSelection`; browse/search query keys include the serialized FilterSet
  so TanStack Query refetches on change; both riders pass `toFilterSet(selection)`.

## Testing (TDD; stakes × logic)

- **Integration** (`queries.itest.ts`): scope union across the three sub-dimensions; kinds IN;
  tagsAll vs tagsAny vs tagsNone (distinct results on the same fixture); all three tag modes
  composed; filters compose with FTS in `search`; empty FilterSet = unfiltered; Zod rejection of
  over-cap arrays.
- **Unit** (`selection.test.tsx`): every helper — toggle on/off, tag cycle order, toFilterSet
  mapping including tagMatch and empty-array omission.
- **Component**: NavRail multi-highlight + tag tri-state rendering + callbacks; FilterBar chips,
  remove, clear-all, hidden-when-empty.
- Not tested: chip colours, control copy (change-detectors).
