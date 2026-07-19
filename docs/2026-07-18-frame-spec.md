# The Frame — Track A part 2 (F0 design record + build spec)

Status: ACTIVE — governs the frame build.
Date: 2026-07-18

The mastermind window: organization (folders substrate, part 1) and
navigation become the way Astrolabe is entered. Renders entirely over
existing tested APIs plus one read-surface extension (§4). Design decisions
below are the F0 record; visual-taste items marked ⚙ are deliberate defaults
Ahmed can override in F4 without structural change.

## 1. Layout — the three-pane spine (O·B·L·A Track A)

```
┌──────────┬──────────────────────────────┬─────────────┐
│ RAIL     │ RIVER                        │ DETAIL      │
│ 240px ⚙  │ (flex)                       │ 340px ⚙     │
│          │ topbar: search · ghosts ·    │ toggleable  │
│          │         sync · stats         │ (auto-opens │
│          │ rows: title/kind/badges/tags │  on select) │
└──────────┴──────────────────────────────┴─────────────┘
```

Persistent spatial model; NO overlays except ⌘K. Selection is real state:
`(railSelection, selectedDocumentId, detailOpen)` — the back/forward history
stack (⌘[ / ⌘]) records exactly this triple.

## 2. The rail (top → bottom; Eagle vocabulary, D-A1)

1. **All** — full river, count = stats.documents.
2. **Uncategorized** — the filing inbox, count badge (uncategorizedCount).
3. **Folders** — the tree (folderTree: own counts; ⚙ subtree count shown
   dimmed beside parents). Expand/collapse persisted in-session. Row
   context menu: New subfolder · Rename · Move to… · Delete. Root-level
   "New Folder" affordance + **Import from Eagle…** (D-A6 gesture; picks a
   library from the snapshot, confirms, shows {created, members, skipped}).
4. **Smart Folders** — section header with "(soon)" — reserved, no rows.
5. **Tags** — name + count list (top N by count, "show all" expands ⚙).
   Click = filter (single-select v1; boolean builder is F4+).
6. **Libraries** — the connector/library strip data relocated here:
   per-library rows w/ availability dot + count; connector status lines.

Rail selection semantics: exactly one of All / Uncategorized / folder /
tag / library selected; selecting scopes the river via the existing
filterSet (folderSlugs+includeSubfolders ⚙ toggle on folder rows / tag →
tagsAny / library → libraryIds). Ghost toggle stays global in the topbar.

## 3. River + Detail

**River rows** (reuse skeleton row anatomy): title, kind, source badges
(connector:library), tags, ghost dimming. Multi-select: click selects,
⌘-click toggles, ⇧-click ranges. Selection count + action bar appears when
>0 selected: **File to folder…** (picker = mini folder tree), **Remove from
this folder** (only when rail = that folder), **Open**.

**Detail panel** (the hub, v1 DocumentHub reborn over v2 data): title ·
kind · modified; **Instances** — one row per copy: connector+library badge,
availability, open buttons (openPdfUri ?? uri via system:open); **Folders**
— membership chips (click chip = navigate to folder); **Tags**;
**Annotations** — count + first 5 previews (text/comment/page) ⚙;
**Backlinks** — notes linking here (click = select that document). Ghost
banner when zero instances.

## 4. Read-surface extension (main-side, the ONE new contract piece)

- `INDEX_DOCUMENT_CHANNEL 'index:document'` → `DocumentDetail`:
  `{ documentId, title, kind, modifiedAt, tags, instances: HitInstance[],
  folders: {slug,name}[], annotations: { total, preview: {text,comment,
  pageLabel}[] (first 5) }, backlinks: BackLink[] }` — composed from
  existing hydrate + documentLinks + folder_members join. Null when unknown.
- `INDEX_TAGS_CHANNEL 'index:tags'` → `{ name, count }[]` desc by count.
- Preload: `astrolabe.document(id)`, `astrolabe.tags()`.
- Request schemas live with queries.ts (module-owned precedent).

## 5. ⌘K + keyboard map

⌘K palette (the ONE overlay): type → matched sections **Folders** (name
match), **Documents** (index:search, debounced ⚙150ms), **Libraries**.
↑↓ navigate, Enter = go (folder/library → rail selection; document → select
+ detail), Esc closes. Plain case-insensitive substring match — NO fuzzy
dep (fuzzysort stays dead).

Global keys: ⌘K palette · ⌘[ / ⌘] history back/forward · f file-selected →
folder picker · Enter/o open selected · Esc clear selection/close detail ·
⌘F focus search. (⚙ map adjustable in F4.)

## 6. State contract (frozen before component build)

`src/renderer/src/frame/state.tsx` — React context, plain hooks, no new
deps (react-query is M4):
- `RailSelection = {kind:'all'} | {kind:'uncategorized'} | {kind:'folder',
  slug, includeSubfolders} | {kind:'tag', name} | {kind:'library', id}`
- `FrameState = { rail: RailSelection; selectedDocumentId: number|null;
  detailOpen: boolean; ghosts: boolean; query: string }`
- Actions: `selectRail`, `selectDocument`, `setQuery`, `toggleGhosts`,
  `goBack`, `goForward` (history = bounded stack ⚙50 of the state triple),
  `refresh` (bumps a version → hooks refetch).
- Data hooks (fetch-on-dependency-change, loading/error tuples):
  `useFolderTree`, `useRiver` (query+rail+ghosts → search|browse),
  `useDocumentDetail(id)`, `useTags`, `useLibraries`, `useStats`.
- `friendlyFolderError(err): string` — maps FolderError codes (CYCLE,
  DUPLICATE, BAD_PARENT, NOT_FOUND, INVALID) to human sentences (closes the
  part-1 deferred item).

## 7. Component ownership (build parallelism, disjoint dirs)

- `frame/rail/` — Rail, FolderTree, rail sections, import dialog.
- `frame/river/` — River, Row, selection model, action bar, FolderPicker.
- `frame/detail/` — DetailPanel + sections.
- `frame/commandk/` — CommandK overlay + useGlobalKeys + history glue.
- `frame/state.tsx` + `App.tsx` composition — integrator only.

## 8. Testing

Component tier activates (jsdom + @testing-library/react arrive as its
first consumers, quarried versions). Per component: behavior tests over a
mocked `window.astrolabe` (the preload boundary IS the seam; no deeper
mocking): rail renders tree + counts and dispatches selection; river
multi-select rules; filing calls addMembers with selected ids; detail
renders instances/folders/backlinks from a fixture DocumentDetail; ⌘K
filters and dispatches. Main-side: itests for index:document (incl. folders
membership + backlinks + annotation preview cap) and index:tags. Existing
suites stay green; gates per commit.

## 9. Non-goals (v1 of the frame)

No drag-and-drop filing (keystroke + picker first; DnD is F4+ ⚙). No
virtualization (M4). No tag boolean builder UI. No Smart Folder creation.
No reader — M3 lands inside the detail pane's future tabs. No renderer
construction of member refs (ids only, always).

## 10. Exit criteria (roadmap Phase 1)

Seeded tree navigable end-to-end; Uncategorized drives filing; filing a
multi-selected batch ≤ 2 keystrokes + 1 click; ⌘K jumps anywhere; history
returns exactly where you were; Eagle import runs from the UI.
