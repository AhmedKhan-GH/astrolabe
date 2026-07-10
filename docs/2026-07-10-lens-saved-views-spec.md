# Lens Saved Views (Track A, step 3) — Design Spec

**Date:** 2026-07-10 · **Status:** approved (surface roadmap; follows boolean filtering)
**Problem:** a boolean selection worth building twice is worth naming once. Views are the first
first-party artifact (docs/00 §inviolable principle): named lenses over the library.

## Storage — user artifact, not index data

One JSON file per view: `<workspace>/.astrolabe/views/<slug>.json`. Files ride the user's
file-sync, survive index rebuilds by construction, and are human-editable. Slug = kebab-cased
name (`[a-z0-9-]`, collapsed); saving a name whose slug exists **overwrites** (upsert).

```ts
export const savedViewFileSchema = z.object({
  schemaVersion: z.literal(1),
  name: z.string().min(1).max(120),
  createdAt: z.iso.datetime(),
  q: z.string().max(500).optional(),           // search text, composes as in the live lens
  filter: storedFilterSchema,                   // FilterSet with collections as STABLE REFS
})
```

`storedFilterSchema` = `filterSetSchema` minus `collectionIds`, plus
`collectionRefs: z.array(z.object({ sourceKey: z.enum([...]), key: z.string().max(200) })).max(100).optional()`
— `key` is `collections.externalKey`, which is stable across rebuilds (unique per source);
raw `collections.id` is index-internal and regenerates on rebuild, so it never enters a view file.

Tag boolean state round-trips losslessly through the FilterSet itself (`tagsAll` xor `tagsAny`
by construction of `toFilterSet`), so no renderer-model fields are persisted.

## Wire contract

New channels in `src/shared/db-ipc.ts` (+ zod request schemas there, file schema lives with the
module): `views:list` → `SavedView[]` (validated, name-sorted; invalid files skipped and logged,
never fatal), `views:save` (`{name, q?, filter}` → slug derived server-side) → `SavedView`,
`views:delete` (`{slug}`) → `boolean`. `SavedView` = file payload + `slug`.

Main module `src/main/lib/views.ts`: `createViewsApi(viewsDir)` — dir injected so tests run on a
tmp dir; `mkdirSync` recursive on first save; atomic write (tmp + rename). Handlers registered in
`src/main/index.ts`; preload exposes `astrolabe.views.{list, save, remove}` — **the e2e preload
allowlist test (`e2e/launch.smoke.spec.ts`) gains the `views` key.**

### `index:nav` addition

Collection `NavNode`s gain `externalKey?: string` (zotero/eagle nodes; obsidian folder ids are
already stable paths). This lets the renderer map id ↔ stable ref in both directions with data it
already holds — no resolve channel.

## Renderer

- `viewRefs.ts` (new, pure): `toStoredFilter(filterSet, navData)` (ids → refs; unknown id dropped)
  and `resolveStoredFilter(stored, navData)` (refs → `FilterSet`; unresolvable refs dropped —
  the FilterBar then shows exactly what applied, which is the honest surface for a stale ref).
  Plus `selectionFromFilterSet(filter): LensSelection` (tagsAll→require+'all', tagsAny→require+'any',
  tagsNone→exclude) — the inverse of `toFilterSet`.
- **NavRail**: "Views" section above Kinds — name per row, click applies, × on hover deletes
  (no native confirm; deletion is a one-file artifact, recoverable by file-sync/undo outside scope).
- **Lens.tsx**: applying a view replaces `q` + selection wholesale; any subsequent manual edit
  clears the applied-view highlight (tracked as `appliedViewSlug`, compared shallowly — cheap and
  honest). "Save view…" affordance lives in the FilterBar when `!isEmpty(selection) || q` —
  inline name input (audit lesson: never `prompt()`), Enter saves via `views.save`, then
  invalidates the `['views']` query.

## Testing (TDD; stakes × logic)

- **Unit**: slugify (spacing/case/duplicate-dash/non-ascii); `viewRefs` both directions incl.
  dropped-unknowns; `selectionFromFilterSet` round-trip against `toFilterSet` fixtures.
- **Integration** (`views.itest.ts`, tmp dir): save→list round-trip; upsert-by-slug; delete;
  invalid JSON file skipped not fatal; schema-violating file skipped.
- **Component**: NavRail views section (render, apply callback, delete callback); FilterBar save
  input (appears when non-empty, Enter fires save with typed name).
- **E2E**: allowlist gains `views`.
