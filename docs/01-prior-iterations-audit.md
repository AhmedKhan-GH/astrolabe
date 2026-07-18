# 01 — Prior Iterations Audit

**Status:** Current — founding design session · **Date:** 2026-07-07

Four repositories in `~/Desktop/astrolabe/` were audited in depth (2026-07-07, one Opus subagent per
repository). This document transfers the full findings. Chronological order.

## Timeline overview

| Repo | Dates | Size | What it is |
|---|---|---|---|
| `astrolabe-main` / `astrolabe-macbook-air` | Dec 18–26, 2025 (9 days, 36 commits) | ~3,081 LOC TS/TSX (+1,445 CSS) | Browser SPA PDF navigator with the "Views" feature |
| `astrolabe` | Dec 31, 2025 (1 day, 15 commits) | ~889 LOC | Electron+React+Vite+SQLite/Drizzle scaffold, demo app only |
| `alidate-astrolabe-current/astrolabe` | Dec 31, 2025 – Apr 1, 2026 (167 commits) | ~5,800 product LOC + ~3,980 test LOC | Polished Electron file/folder organizer |
| `alidate-astrolabe-current/alidade` | Feb 22, 2026 (1 commit) | 13 LOC | Empty Express backend placeholder |

The lineage is visible in the code: the alidate-era `astrolabe` still contains a stray compiled
`schema.js` exporting the `users`/`records` demo tables from the Dec 31 scaffold — the scaffold
evolved directly into the file organizer.

---

## Iteration 1: `astrolabe-main` / `astrolabe-macbook-air` (the PDF navigator)

Two directories, same codebase (identical LOC); `-macbook-air` retains the git history.

### What it is

A single-renderer React/Vite **PDF navigator**. README self-describes as "A PDF Reader for efficient
workflow with Excalidraw" and calls itself a "Web Application."

### Stack

React 18.3 + Vite 7 + TypeScript 5.9; `pdfjs-dist` 4.x (legacy build, correctly wired via
`new URL(..., import.meta.url)` worker setup); `@excalidraw/excalidraw` 0.18; no state manager, no
DB/ORM (raw IndexedDB + localStorage), no router, no search, no editor, no AI libraries.

### The phantom Electron layer

`package.json` declared `"main": "electron/main.js"` and Forge scripts, and `forge.config.js`
existed — but there was **no `electron/` directory, no preload, no IPC, and neither electron nor
electron-forge was installed.** The git history in `-macbook-air` explains it:
`e5ad85e working electron distributable` → `c2f0c38 before tauri` (a Tauri flirtation) →
`4bc222d removed electron` → `75aa1f2 fixed resizing issues and removed electron`. The desktop shell
was built, doubted, and torn out. The working tree was left mid-teardown and **does not build**
(`index.html`, `tsconfig.app.json`, `tsconfig.node.json` locally deleted, uncommitted). A deleted
1,450-line `chat_transcript.md` in the history shows the build was heavily AI-assisted.

### Features that worked

- **PDF viewer**: single-page canvas rendering with devicePixelRatio scaling, fit-to-page, zoom
  (25–300%), page jump, prev/next
- **TOC/outline**: recursive tree from `pdf.getOutline()`, expand/collapse, checkbox cascade,
  click-to-navigate via destination resolution
- **Pages & "Loose" views**: lazy thumbnail strip and reflowable grid via IntersectionObserver +
  low-res canvases, with click/shift/ctrl/drag multi-select
- **"Views"** — the crown jewel (see below)
- **Excalidraw canvas** per file, debounced autosave
- **Workspace export/import**: a custom `.astro` JSON file

### The "Views" concept — the most original idea in all four repos

A **View** is a saved, named subset of a document: a set of TOC sections and/or page ranges.
Selecting a View greys out non-member pages and TOC nodes across every navigation surface and
enables jump-to-view. Two non-trivial algorithms power it (both in `DocumentViewer.tsx`):

1. **TOC-path → page-range inference** (`buildPageMap`, ~line 349): derives each outline section's
   page span from the outline structure by finding the next non-descendant section's start page
2. **Pages → minimal covering TOC paths** (`findTocPathsForPages`, ~line 672): greedy set-cover
   reducing an arbitrary page selection to the minimal set of TOC nodes that cover it

Also reusable: TOC nodes addressed as **path strings** (`/0/2/1`) — a stable addressing scheme for
outline positions.

### Failure modes recorded

- **Storage contradicted the vision**: PDF binaries as Blobs inside IndexedDB; Excalidraw drawings in
  localStorage (will silently exceed the ~5 MB quota); session state in localStorage; export =
  entire library base64-inlined into one JSON string in memory (OOMs on a real library); import
  **wipes all existing data** before restoring
- **God component**: `DocumentViewer.tsx` — 1,963 lines, ~40 `useState`, ~20 `useEffect`, imperative
  DOM scrolling, magic `setTimeout(…, 100)` calls
- **Fragile identity**: files keyed by a `uniqueId` attached to `File` objects via
  `Object.defineProperty`; deletion by **filename** (duplicate names collide)
- IndexedDB schema duplicated in three files; version constant hard-coded in the importer
- Native `alert()`/`confirm()`/`prompt()` for core flows
- Terminology drift: code says `Note`, UI says "View"; `NoteEditor` renders Excalidraw
- ~41 stray `console.*` calls; zero tests; zero TODO markers (debt unannotated, not absent)

---

## Iteration 2: `astrolabe` (the scaffold)

### What it is

A one-day (Dec 31, 2025) scaffolding session: Electron 39 + React 19 + Vite 7 + TypeScript 5.9
(strict) + better-sqlite3 12 + Drizzle 0.45 + Vitest. The only "app" is a **Timestamp Recorder**
demo (insert a row, list rows, `LIKE` search on title). No domain model — the schema is two demo
tables (`records`, `users`, no relations).

### The one genuinely good idea: the type-safe generic IPC pattern

- A single `db:query` IPC channel dispatches generic CRUD (`getAll/getById/create/update/delete`)
  against any table by name; a `db:custom` channel is the escape hatch for hand-written queries
- The preload's `createTableClient<TSelect, TInsert>()` factory produces a fully **type-safe client
  per table**, so Drizzle's `$inferSelect`/`$inferInsert` types flow schema → IPC → React with zero
  duplication. Add a table to the schema; typed CRUD appears everywhere.
- Secure Electron defaults done right: `contextIsolation: true`, `nodeIntegration: false`,
  contextBridge-only surface; boot order DB → IPC → window with fail-fast `app.quit()`
- SQLite at `userData/data/astrolabe.db` with WAL; Drizzle migrations run on boot with dev/packaged
  path resolution

### Recorded footguns

- `.gitignore` ignored `drizzle/` while `electron-builder` bundled `drizzle/**/*` as
  `extraResources` — the migrations needed at runtime were gitignored
- A dead parallel migration path (`src/db/migrate.ts`) pointing at a *different* DB path
- Test config was theater: well-configured Vitest + coverage, but only placeholder example specs;
  zero tests on real code
- The generic `(schema as any)[table]` handler cannot express transactions, joins, FTS, or
  pagination — real features would all fall through to `db:custom`; a proper repository/service
  layer is needed at scale

---

## Iteration 3: `alidate-astrolabe-current/astrolabe` (the file organizer)

### What it is

The most mature work: 167 commits over three months (Dec 31, 2025 – Apr 1, 2026), evolving the
scaffold into a strictly-typed, well-logged Electron **file/folder organizer** — the Eagle.cool
"library" layer, and only that.

### Stack

Electron 39, React 19, Vite 7, **Tailwind 4**, TS 5.9 strict everywhere, better-sqlite3 + Drizzle
(11 migrations), electron-store, Zod (added late, barely used), **Pino** structured logging,
TypeDoc, Vitest + Testing Library. No state manager (prop drilling + `useState` only). **No PDF
library, no editor, no search library, no AI SDK** — grep returns zero hits for all of them.

### Architecture worth recording

- Correct 3-process Electron split; ~38 `ipcRenderer.invoke` wrappers exposed via contextBridge;
  IPC handler groups (`FileProcess.ts`, `FolderProcess.ts`, `DatabaseProcess.ts`) that defensively
  `removeHandler()` before re-registering to survive DB switches
- **Service seam**: `IFileService`/`IFolderService` interfaces + `ServiceFactory`
  (`mode: 'local'|'remote'` from env) with `LocalFileService`/`LocalFolderService` real and
  `RemoteFileService`/`RemoteFolderService` as HTTP stubs pointing at a nonexistent API — the seam
  intended for alidade
- **Operations layer**: `FileOperations.ts` (283 LOC) and `FolderOperations.ts` (649 LOC) hold the
  real Drizzle business logic — CRUD, junction-table linking, ancestor expansion, move/merge
- **Schema**: `folders` (self-referential tree via `parentId`, root=0), `files` (filename, path,
  filetype, `fileStorageType: 'import'|'reference'`), `file_folders` junction (composite PK,
  cascade) — **many-to-many**, one file in multiple folders. Migration `0008` shows the model was
  refactored from 1:N to M:N mid-project.
- **The `.astro` bundle**: user data is a self-contained package directory (an `Info.plist` bundle
  on macOS) containing `astrolabe.db` + a `files/` tree. Import mode *copies* files in; reference
  mode stores only the external absolute path. Multi-library switching via electron-store +
  `reinitDatabase()`.

### Features implemented

Import/reference PDFs with duplicate detection; nested folder tree with create/rename/move/merge/
delete, drag-and-drop, recursive expand; filtering by All/Imports/References/Trash; multi-database
switching; open reference files externally via `shell.openPath`.

### Quality signals (both directions)

Strong: ~3,980 lines of tests on the operations layer (~40% of the codebase); zero `: any`, zero
`console.log`, zero TODO in product code; consistent Pino logging with context objects; error
dialogs with cleanup-on-failure in import; a committed `AI_BEST_PRACTICES.md` (220 lines) codifying
conventions for AI-assisted development; 167 small, descriptive commits.

Weak: **the "content hash" is `crypto.randomBytes(8)`** — random, not a hash; no dedup, no
integrity, despite README claims. Dedup is by filename string. **README describes BLOB storage that
does not exist** (no BLOB column anywhere) — the docs were aspirational boilerplate, not derived
from code. Trash is a magic string (`fileStorageType === 'trash'`) the schema never defines — a
leaky half-built soft-delete. DB switch does a full `webContents.reloadIgnoringCache()` with a
`setTimeout(…, 100)` race hack. Stray compiled `schema.js` from the old scaffold committed. TypeDoc
`docs/` reference components deleted from `src/`. `.env` committed. UI components, services, IPC,
and settings all untested.

### The verdict recorded at audit time

> Enormous energy went into infra (multi-DB switching, service factory, remote stubs, 4k lines of
> folder tests, TypeDoc) while zero core product value (PDF viewing, annotation, notes, search,
> graph, AI) was built. The 80/20 was inverted. The RightSidebar literally says
> "Placeholder for file details." Imported files could not even be opened in-app.

---

## Iteration 4: `alidate-astrolabe-current/alidade` (the backend placeholder)

One commit ("node + express backend initial commit", Feb 22, 2026). `index.ts` — 13 lines, Express 5
"Hello World" on port 3000. Notably strict tsconfig (`noUncheckedIndexedAccess`,
`exactOptionalPropertyTypes`). Nothing else. Three months after creation, still a hello-world —
the canonical lesson in not building the backend before the need.

---

## Cross-cutting lessons (the design constraints for this iteration)

1. **Shell indecision kills momentum.** Electron → Tauri → pure web thrash left a broken tree.
   Decision: Electron, final, recorded as an ADR. No relitigating.
2. **Infra-before-features kills products.** Every iteration built plumbing; none built the product.
   Decision: every roadmap phase must end with something personally usable that week.
3. **Browser storage contradicts local-first.** Files belong on the real filesystem; SQLite is an
   index, never the store. (In the orchestrator architecture this is fully resolved: the systems of
   record own all files.)
4. **God components accrete.** Decompose the viewer; separate rendering, navigation, selection, and
   model. Adopt a real state layer from day one.
5. **Aspirational docs rot instantly.** READMEs describing nonexistent features (BLOB storage, fake
   content hashes) came from generating docs before code. Docs get written from code.
6. **Name concepts once.** `Note` vs "View" vs `NoteEditor`-that-renders-Excalidraw cost real
   comprehension. This iteration's glossary: Astrolabe (app), Alioth (agent), alidade (licensing
   API), View (saved lens), Dialogue (persisted agent conversation).
7. **Model soft-delete and identity explicitly.** No magic strings; stable IDs (content hashes where
   applicable), never filename identity.

## Salvage manifest (what to port, from where)

| Asset | Source | Destination in rebuild |
|---|---|---|
| Views concept + `buildPageMap` + `findTocPathsForPages` | `astrolabe-main/src/components/DocumentViewer.tsx:349,672` | v2 reader; algorithms are pure functions, port with tests |
| TOC path-string addressing (`/0/2/1`) | same | graph provenance anchors for PDF locations |
| Lazy thumbnail rendering (IntersectionObserver + low-res canvas) | same, ~line 990 | v2 reader |
| pdf.js legacy worker wiring for Vite | `astrolabe-main/src/components/DocumentViewer.tsx:8-11` | v2 reader |
| Type-safe generic IPC / table-client pattern | `astrolabe/electron/{ipc,preload}.ts` | index layer IPC |
| Drizzle `$infer` single-source-of-truth typing | both Drizzle repos | everywhere |
| Secure Electron defaults + boot order | both Electron repos | main process |
| `.astro`/`.astrolabe` self-contained workspace bundle concept | `alidate .../electron/settings.ts` | the `.astrolabe/` workspace dir |
| Import-vs-reference distinction | `alidate .../LocalFileService.ts` | ink-ingestion pipeline (copy vs link semantics) |
| M:N junction modeling + tested tree operations | `alidate .../src/db/operations/` | graph edge tables; port the test discipline |
| Pino structured logging setup | alidate | main process |
| `AI_BEST_PRACTICES.md` conventions | alidate repo root | this repo's `CLAUDE.md` |
