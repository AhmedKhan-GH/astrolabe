# Library Navigator (Lens v1) — Design Spec

**Date:** 2026-07-10 · **Status:** approved (option D of the brainstorm)
**Problem:** the Lens is search-only — an empty box over 1,561 indexed documents. There is no way to *see* the knowledge space or browse into it without already knowing what to type.

## Goal

A live, full view of the indexed totality: a **left navigation rail** (structure + tags + kinds) and a **recency river** center pane (everything, newest-modified first, virtualized). Search composes with — rather than replaces — navigation.

Non-goals (v1): graph view, multi-select filters, saved views, drag/reorder, editing anything. The index stays read-only in the Lens.

## Layout

```
┌────────────────────────────────────────────────────────┐
│ header: title · Sync now · Rebuild index               │
│ stats strip: totals + per-source badges (unchanged)    │
├───────────────┬────────────────────────────────────────┤
│ NavRail       │ search input                           │
│  Kinds        │ ┌────────────────────────────────────┐ │
│  Sources      │ │ q empty  → DocumentRiver (browse)  │ │
│   ▸ zotero    │ │ q typed  → search hits (FTS)       │ │
│   ▸ eagle     │ │ both respect the active selection  │ │
│   ▸ obsidian  │ └────────────────────────────────────┘ │
│  Tags         │                                        │
└───────────────┴────────────────────────────────────────┘
```

Window widens from `max-w-3xl` to a two-pane flex layout; rail is ~15rem, scrollable, always visible.

## Selection model

One active value per dimension, all composing with AND:

```ts
interface LensSelection {
  sourceKey?: 'zotero' | 'eagle' | 'obsidian'
  collectionId?: number      // zotero/eagle tree node; implies its source
  folderPrefix?: string      // obsidian folder path ('Projects/'); implies obsidian
  tag?: string               // tag name
  kind?: 'pdf' | 'image' | 'note' | 'other'
}
```

Clicking a selected item deselects it (toggle). Selecting a collection/folder clears any plain source selection and vice versa. `collectionId` and `folderPrefix` are mutually exclusive by construction (different trees).

## Wire contracts (named channels; docs/01 ceiling — joins never ride the generic table-client)

### `index:browse` — the river

```ts
browseRequestSchema = z.object({
  sourceKey: z.enum(['zotero', 'eagle', 'obsidian']).optional(),
  collectionId: z.number().int().positive().optional(),
  folderPrefix: z.string().max(500).optional(),   // matched as externalKey LIKE '<prefix>%'
  tag: z.string().max(200).optional(),
  kind: z.enum(['pdf', 'image', 'note', 'other']).optional(),
  offset: z.number().int().min(0).default(0),
  limit: z.number().int().positive().max(200).default(100),
})

interface BrowseHit {           // SearchHit minus snippet, plus modifiedAt
  documentId: number
  title: string
  kind: string
  modifiedAt: number
  tags: string[]
  instances: { sourceKey: string; uri: string; filePath: string | null }[]
}
interface BrowsePage { total: number; hits: BrowseHit[] }
```

Ordering: `documents.modifiedAt DESC, documents.id DESC`. Offset pagination — at 10³–10⁴ documents SQLite offset cost is irrelevant; keyset is YAGNI. `total` is the filtered distinct-document count (drives the virtualizer size and a "N documents" readout).

### `index:nav` — the rail payload (one call, small)

```ts
interface NavNode { id: number | string; name: string; count: number; children: NavNode[] }
// id = collections.id (zotero/eagle) | folder path string (obsidian)
interface NavData {
  kinds: { kind: string; count: number }[]                    // index-wide
  sources: { key: string; status: string; documentCount: number; tree: NavNode[] }[]
  tags: { name: string; count: number }[]                     // all tags, count desc
}
```

- zotero/eagle trees come from `collections` (parentId nesting) + **direct-membership** distinct doc counts (no subtree roll-up in v1 — stated on the node title).
- obsidian tree is derived from `document_instances.externalKey` relpaths (dirname segments); folder count = documents directly in that folder.
- Tags payload is all ~1.2k rows; the renderer search-filters and truncates the display (top 40 + "filter tags…" input). No server paging.

### `index:search` — grows the same optional filters

`searchRequestSchema` gains `sourceKey/collectionId/folderPrefix/tag/kind` (same shapes as browse). SQL: FTS MATCH first, then joins narrow. Result shape unchanged.

## Module plan

**Main process**
- `src/main/index/nav-tree.ts` (new, pure): `buildCollectionTree(rows, countByCollection)` and `buildFolderTree(relPaths)` → `NavNode[]`. All the branching lives here → unit-tested.
- `src/main/index/queries.ts`: add `browse(raw)`, `nav()`; extend `search` with filters. Filter SQL shared by a private helper. Integration-tested against real SQLite (pattern of `upsert.itest.ts`).
- `src/shared/db-ipc.ts`: `INDEX_BROWSE_CHANNEL`, `INDEX_NAV_CHANNEL`, `browseRequestSchema`, extended `searchRequestSchema`.
- `src/main/index.ts`: two `ipcMain.handle` lines.
- `src/preload/index.ts`: `index.browse(req)`, `index.nav()`; search passes filters through.

**Renderer** (`src/renderer/src/lens/`)
- `Lens.tsx`: owns `q` + `LensSelection`; two-pane layout; picks river vs search per `q`; invalidates `['browse']`/`['nav']` alongside existing keys after sync/rebuild.
- `NavRail.tsx` (new): Kinds chips, Sources sections, Tags block (filter input + top-N). Receives `NavData`, selection, `onSelect` callbacks. Selected item highlighted; badge counts right-aligned.
- `CollectionTree.tsx` (new): recursive expand/collapse (chevrons; roots expanded, children collapsed by default; expansion state local).
- `DocumentRiver.tsx` (new): `useInfiniteQuery` over `browse` (page = offset/limit) + `@tanstack/react-virtual` (already a dependency); row = title, kind, relative modified date, tag chips, per-instance jump-outs (reusing the `SearchResult` action pattern).

## Error handling

- Zod rejects malformed requests at the channel boundary (existing pattern).
- Browse/nav failures render the existing red error line in the pane; the rail dims (never blanks the app — doc 10 §4).
- Empty river (fresh index) shows "index is empty — Sync now".

## Testing (TDD; stakes × logic)

- **Unit:** `nav-tree.test.ts` — nesting, orphan parentId → root, folder derivation (nested paths, root-level notes, trailing counts), empty inputs.
- **Integration:** `queries.itest.ts` additions — browse: each filter alone + composed, ordering, offset/limit/total; nav: counts per source/collection/kind/tag; search-with-filter narrows FTS hits.
- **Component:** `NavRail.test.tsx` — renders sections with counts, click → `onSelect` payload, selected highlighting, toggle-off. `DocumentRiver.test.tsx` — renders rows from a page, empty state. (Virtualized scroll physics not jsdom-testable — not attempted.)
- **E2E smoke:** unchanged (top-level preload keys stable).

No tests for: rail styling, chip colours, relative-date copy (change-detectors).

## Execution note

Implementation is dispatched to two parallel Opus subagents — backend (main/shared/preload + tests) and frontend (renderer + tests) — coding against the wire contracts above verbatim; integration + full suite run by the orchestrator afterwards.
