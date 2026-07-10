# Lens Virtual Collections (Track A, step 4) — Design Spec

**Date:** 2026-07-10 · **Status:** approved (surface roadmap; follows saved views)
**Problem:** organization today mirrors the sources' own trees. The M:N, source-independent
grouping — one document in many collections, regardless of which tool holds the bytes — is the
Eagle-grade primitive that dissolves the Zotero↔Eagle split in daily use. First user-owned *data*.

## Architecture: files are truth, the index is a mirror

Same law as everything else: **source of record = `.astrolabe/collections/<slug>.json`**
(rides file-sync, survives rebuilds, human-editable); **SQLite = derived mirror** enabling SQL
(counts, facet filtering) — dropped and rebuilt from the files at any time.

```ts
memberRefSchema = z.union([
  z.object({ hash: z.string().length(64) }),                    // documents.contentSha256 — preferred
  z.object({ sourceKey: z.enum([...]), key: z.string().max(500) }), // instance (sourceId, externalKey) — fallback
])
virtualCollectionFileSchema = z.object({
  schemaVersion: z.literal(1),
  name: z.string().min(1).max(120),
  createdAt: z.iso.datetime(),
  members: z.array(memberRefSchema).max(10_000),
})
```

Slug = shared `slugify` (extract from views.ts into `src/main/lib/slug.ts`, re-export to keep
views.ts's surface stable). Ref creation order: instance with a `contentSha256` on its document →
`{hash}`; else `{sourceKey, key}` from any instance (prefer zotero > eagle > obsidian for
determinism). Unresolvable refs are **retained in the file** (the document may reappear on the
next sync) — they're just not mirrored, and surface as `unresolvedCount`.

## Mirror tables (schema.ts + drizzle migration)

- `virtual_collections`: id PK, slug unique, name.
- `virtual_collection_members`: vcId FK cascade, documentId FK cascade, unique(vcId, documentId).

`syncVirtualCollections(db, dir)`: read + validate all files (invalid skipped, pino warn),
resolve refs (hash → documents; else instances join), replace mirror wholesale in one
transaction. Called: at boot after DB init; after every `index:sync` / `index:rebuild` (at the
handler site in `src/main/index.ts`, not inside sync.ts); after every VC mutation.

## Wire contract

Channels + preload `astrolabe.collections.{list, create, remove, addMembers, removeMembers}`
(e2e allowlist gains `collections`):

- `vcollections:list` → `{slug, name, count, unresolvedCount}[]` (name-sorted)
- `vcollections:create` `{name}` → created summary (upsert-by-slug like views)
- `vcollections:delete` `{slug}` → boolean
- `vcollections:add-members` / `vcollections:remove-members` `{slug, documentIds: number[]}` →
  updated summary. Main converts ids → refs (hash-first) on add; remove matches by resolving the
  file's refs against the ids. Both dedupe, rewrite the file atomically, re-mirror.

**FilterSet** gains `virtualCollections: z.array(z.string().max(140)).max(50).optional()` (slugs)
— a fourth **scope** sub-predicate (OR with sources/collections/folders):
`EXISTS (SELECT 1 FROM virtual_collection_members vm JOIN virtual_collections vc ON vm.vc_id = vc.id
 WHERE vm.document_id = d.id AND vc.slug IN (…))`.
Slugs are rebuild-stable, so **StoredFilter passes them through verbatim** — saved views compose
with virtual collections for free.

**NavData** gains `virtualCollections: {slug, name, count}[]`.
**BrowseHit/SearchHit** gain `virtualCollections: string[]` (slugs, from `hydrate`) — drives the
membership popover's checked state.

## Renderer

- **LensSelection** gains `virtualCollections: string[]`; `toggleScope` accepts the new dim;
  `toFilterSet`/`selectionFromFilterSet` map it; FilterBar chips label via nav lookup.
- **NavRail**: "Collections" section (between Views and Kinds): count-badged rows, click =
  scope toggle, × on hover deletes, inline "New collection…" input at the bottom (pattern of the
  save-view input). Rows also show an unresolved marker (`n unresolved`) only when non-zero.
- **DocumentRiver**: row hover reveals a `＋` affordance → popover: checkbox per virtual
  collection (checked = row's slug list), toggling fires add/remove for that document; footer
  "New collection" input creates then adds. Popover is renderer-local state; no portal library —
  absolutely-positioned within the row, closed on outside click/Escape.
- **Lens.tsx**: `['vcollections']` query; mutations invalidate `['vcollections']`, `['nav']`,
  `['browse']` (membership changes counts and row chips).

## Testing (TDD; stakes × logic)

- **Unit**: slug extraction unchanged-behaviour; ref-creation precedence (hash first, source
  order fallback); selection/toFilterSet round-trip with the new dim.
- **Integration**: file CRUD + upsert; mirror resolution via hash AND via instance fallback;
  unresolved retained in file + counted, excluded from mirror; re-mirror after member mutation;
  browse/search filtered by slug (incl. OR with other scope dims); nav payload; hit hydration
  carries slugs; mirror survives simulated rebuild (wipe index tables, re-sync docs, re-mirror →
  members restored via hash).
- **Component**: rail section (render/toggle/delete/create-input); river popover (open, checked
  state from hit, toggle callbacks, create+add); FilterBar chip for the new dim.
- **E2E**: allowlist gains `collections`.
