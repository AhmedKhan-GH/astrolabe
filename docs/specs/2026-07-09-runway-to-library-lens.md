# Implementation Spec — Runway to the Library Lens (+ interim agentic access)

**Status:** Dated implementation spec (point-in-time working document) · **Date:** 2026-07-09
**From commit:** `0718ae5` (test harness landed) · **Delivers:** infra Pillars 2–3, index schema v1,
Zotero + Eagle connectors, Library Lens v0, and the interim MCP server — roadmap Phase 1 core plus a
new Phase 1.5.

Each step is one (occasionally two) green Conventional Commits, ends with the listed **Definition of
done**, and updates docs-from-code in the same commit (doc 07 repo-state; INFRASTRUCTURE-SPEC pillar
status). TDD per ADR-0006: the tier is named per step. Steps are strictly ordered; no step starts
before the previous one's DoD holds.

---

## 0. Ground truth (verified live, 2026-07-09 session)

Facts the implementation can rely on, observed against the real apps on this machine:

- **Zotero local API** answers keyless at `http://localhost:23119/api/users/0/…`, mirroring web API
  v3 shapes. Verified: `/items?limit=N&format=json` returns full item JSON;
  `/items?itemType=annotation` returns annotations with `annotationText`, `annotationComment`,
  `annotationPageLabel`, `parentItem`, `key`.
- **Eagle API** answers at `http://localhost:41595/api/…` **without a token** on this setup (v4.0.0).
  Verified: `/api/application/info`; `/api/item/list?limit=N` returns `{status, data:[{id, name,
  ext, tags, folders, …}]}`. The user's recent Eagle items are **PDFs** — Eagle items must be treated
  as first-class documents, not only images (pain-map memory).
- **Eagle must be running** for its API to answer (connection refused otherwise; launching the app
  brings the port up in ~10s). Connector must degrade gracefully + offer "Launch Eagle"
  (`shell.openPath` on the app / `open -a Eagle`).
- **Dev-vs-built divergence is real here** (the smoke's favicon catch): every step that adds renderer
  behavior re-runs `pnpm test:e2e` against the *built* app.

**Verify-at-implementation list** (believed true from web-API parity; confirm before relying):
`?since=<version>` incremental sync + `Last-Modified-Version` response header on the local API;
pagination mechanics (`start`/`limit` + `Link` header); deleted-item discovery
(`/deleted?since=` or trash flags); attachment file-path resolution (`path` field vs
`/items/{key}/file`); Eagle library file paths via `/api/library/info` (`images/{id}.info/`).

## Conventions for every step

- **Commit style:** small, green, Conventional Commits with scope; infra as its own commit.
- **Tests:** Tier A (branch/transform/rule, data-bearing) = failing test first. Fixtures for
  connector mapping are **captured from the live local APIs** (sanitized), committed under
  `src/…/__fixtures__/`. Integration tier = real better-sqlite3 in a temp dir. No change-detectors.
- **IPC:** every new channel is exposed only through the preload allowlist; the smoke's
  "exactly its allowlist" assertion is updated in the same commit (it is the security contract).
- **Zero tokens throughout** — nothing in this spec calls a model. First model call is Phase 2.

---

## Step 1 — Pino structured logging

**Commit:** `feat: pino structured logging (main process)`

- `src/main/lib/logger.ts`: one Pino instance; JSON to stdout; level from env (`ASTROLABE_LOG_LEVEL`,
  default `info`). File sink `userData/logs/main.log` (simple append; rotation = D-INF-3, deferred).
- **`pino-pretty` dev-only** via dynamic import guarded on `!app.isPackaged` (worker-thread transport
  breaks in asar — INFRASTRUCTURE-SPEC Pillar 2 gotcha).
- Convention (alidate-carried): child loggers per module — `logger.child({ mod: 'connector.zotero' })`;
  errors logged with context objects, never string-interpolated.
- Replace any incidental `console.*` in main.

**Tier:** C (config) — no red-green. **DoD:** `pnpm dev` and the built app both emit structured
startup lines; smoke still 4/4.

## Step 2 — Workspace + SQLite + Drizzle + typed IPC

**Commits:** `feat: .astrolabe workspace + better-sqlite3/drizzle boot` then
`feat: typed IPC table-client` (separable; may land together if small).

**Workspace (provisionally resolves D-INF-1):** default workspace at `~/Astrolabe/` containing
`.astrolabe/{manifest.json, index.db}`. Manifest carries `schemaVersion`, workspace id, connector
config (no secrets). A user-chosen workspace directory (for the Syncthing story) is a later
settings feature; the path is read from one place (`src/main/lib/workspace.ts`) so the chooser is a
one-file change. *Record in INFRASTRUCTURE-SPEC when landed.*

**DB boot:** `dependencies`: `better-sqlite3`, `drizzle-orm`; dev: `drizzle-kit`,
`@types/better-sqlite3`. Add `"postinstall": "electron-builder install-app-deps"` (its consuming
moment — ABI rebuild for dev *and* packaged; `asarUnpack` already present). Boot order becomes
**DB → IPC → window, fail-fast quit** on init/migration error (log via Step 1, dialog, `app.quit()`).
WAL on. Migrations in `drizzle/` (committed — iteration-2 scar), run on boot with dev/packaged path
resolution.

**Typed IPC (salvaged pattern, scoped):** generic `db:query` channel dispatching
`getAll/getById/create/update/delete` by table name against a whitelisted table map +
`createTableClient<TSelect, TInsert>()` in preload so Drizzle `$infer` types flow schema → IPC →
renderer. **Recorded ceiling** (audit): FTS/joins/transactions do NOT go through the generic channel —
they get named channels (`index:search`, `index:rebuild`, added in Steps 3/6).

**Tier A (failing tests first):** the `db:query` dispatcher (unknown table rejected; op routing;
input validation with zod at the IPC boundary). **Integration:** open temp-dir DB, run real
migrations, round-trip one row. **E2E:** extend smoke — `window.astrolabe` gains `db` key; boot with
an unwritable workspace path fails fast (manual check, not CI).

**Packaged check:** `pnpm package:dir` once here — better-sqlite3 must load in the built `.app`
(the ABI class of bug; catch it now, not at Phase 2).

**DoD:** a trivial row survives app restart in `~/Astrolabe/.astrolabe/index.db`; all gates green.

## Step 3 — Index schema v1 + connector contract + FTS5 + rebuild

**Commit:** `feat: index schema v1 + connector contract`

**Schema (Drizzle, all derived/rebuildable — ADR-0005):**

- `sources` — id (`'zotero' | 'eagle' | 'obsidian'`), kind, status (`ok|unavailable|disabled`),
  `syncCursor` (text: Zotero library version / Eagle mtime watermark), `lastSyncAt`.
- `documents` — the **cross-source entity**: id, `contentSha256` (unique, nullable until hashed),
  title, kind (`pdf|image|note|…`), timestamps.
- `document_instances` — the join to reality: documentId FK, sourceId FK, `externalKey`
  (Zotero item key / Eagle id / vault relpath), `uri` (provenance deep link), `filePath`,
  `meta` JSON; **unique(sourceId, externalKey)**. One document ↔ many instances = the
  Zotero↔Eagle hash join realized.
- `tags` (+ `document_tags` M:N) and `collections` (sourceId, externalKey, name, parentId;
  + `document_collections` M:N) — Eagle-grade organization overlaid on everything.
- `annotations` — instanceId FK, type, text, comment, pageLabel, color, position JSON,
  externalKey, modifiedAt.
- **FTS5** virtual table `search_fts(title, body, tags)` maintained inside the same upsert
  transaction as its source rows (raw SQL in migration; triggers acceptable alternative).

Soft-delete via `deletedAt` where needed; **no magic strings** (principle 9); content hash =
real SHA-256 streamed off disk, hashed only when `(size, mtime)` changed since last hash.

**Connector contract** (`src/main/connectors/types.ts`):

```ts
interface Connector {
  readonly id: SourceId
  scan(ctx: SyncContext): Promise<ScanResult>      // incremental via sources.syncCursor
  resolve(uri: string): Promise<ResolveResult>     // provenance → openable target
  watch?(onChange: () => void): Unwatch            // obsidian later
  checkAvailable(): Promise<boolean>               // eagle: port probe
}
```

Connectors are registered in one flat registry; **no connector imports another** (doc 10 §5).
The mechanical teeth land here: **`eslint-plugin-import-x`** (Polaris-proven) with
`no-restricted-paths` zones — connectors can't import each other, `lib/` can't import feature
modules. This converts doc 10's "(to build)" enforcement note into lint-time law.

**`index:rebuild`** named channel: wipe derived tables, reset cursors, full resync — exists and
works **before any connector lands** (ADR-0005 made operational).

**Tier A:** upsert idempotency (same scan twice = no dupes), hash-join rule (same sha256 from two
sources → one document, two instances), FTS row lifecycle, rebuild = empty-then-repopulated.
**DoD:** integration suite green against real temp SQLite; rebuild callable from a dev menu item.

## Step 4 — Zotero connector (read)

**Commit:** `feat(connector): zotero read sync`

- Client for `localhost:23119/api/users/0/…` (plain `fetch`, no SDK): `/items` paginated,
  `/collections`, annotations (`itemType=annotation`), attachments (contentType, filePath).
- **Incremental:** first sync full walk; store library version as `syncCursor`; subsequent syncs
  `?since=cursor` (verify-at-implementation item; fall back to modified-time filtering if `since`
  is unsupported locally).
- **Mapping:** parent item → `documents` (+instance, `zotero://select/library/items/KEY` URI);
  PDF attachment → filePath + SHA-256 → hash-join; annotation → `annotations` under the attachment's
  instance; collections/tags → M:N rows. Page-anchored provenance for annotations:
  `zotero://open-pdf/library/items/ATTACHKEY?page=N`.
- Scheduling: sync on boot + manual "Sync now" IPC + 5-min interval (chokidar-style watching is an
  Obsidian concern; Zotero is poll-based).
- Degrade: Zotero not running → source `unavailable`, log, UI badge (Step 6); never crashes the app.

**Tier A, fixtures-first:** response→row mapping tested against sanitized captures from the live
API (items, annotations, collections pages); cursor advance; deleted-item handling (whichever
mechanism verification finds). **DoD — personally usable:** run sync, open a SQL shell (or dev
panel), see your real items + annotations in the index; `annotations` FTS-searchable via
`index:search` from a REPL.

## Step 5 — Eagle connector (read) + the hash join lights up

**Commit:** `feat(connector): eagle read sync`

- Client for `localhost:41595/api/…`: `/application/info` (availability + version),
  `/library/info` (library path), `/item/list` paginated, `/folder/list` (nested folder tree →
  `collections` with parentId). Token param supported but unused unless a setup requires it.
- **Mapping:** item → document instance (`eagle://item/ID` URI); ext-based kind (**pdf items are
  documents**, image items assets); file path from library layout (verify item) → SHA-256 →
  **join against Zotero-held copies**; Eagle tags → `tags`; folder memberships → M:N (Eagle's
  multiple-membership maps 1:1 onto the junction table).
- **Availability UX:** `checkAvailable()` = port probe; `unavailable` state carries a
  `launchHint` the UI turns into a "Launch Eagle" button.
- Incremental: `modificationTime` watermark cursor.

**Tier A:** mapping fixtures from the live API; the join (same PDF in both tools → one row in
`documents`, two in `document_instances`) — this is the money logic, test it hardest; folder-tree
→ collections recursion. **DoD — personally usable:** Murphy's *Probabilistic ML* (Eagle) and any
Zotero-annotated copy of the same file resolve to **one document**; querying it returns both
provenance URIs.

## Step 6 — Library Lens v0 (the visible payoff)

**Commits:** `feat: library lens` (+ `feat: lens filters/views` if it splits naturally)

**Enters here (build-on-consumption):** TanStack Query (over IPC — caching/invalidation, kills any
reload-the-window instinct), Zustand (lens UI state), Tailwind 4 + shadcn/ui (first real UI, bringing
clsx/tailwind-merge/cva/lucide-react), **@tanstack/react-virtual** (the results list is
thousands of rows on a real library — virtualized from day one), and **fuzzysort**
(Polaris-proven) for instant client-side title/tag typeahead alongside FTS5 content search.
Replace the template App with the lens shell; delete template assets.

- **`index:search` named channel:** input `{q?, tags?, collections?, sourceIds?, kinds?}` →
  FTS5 match + M:N filters (AND/OR boolean tag logic — the Eagle-grade primitive) → ranked rows
  with snippet + provenance list. Zod-validated at the boundary.
- **UI:** search box; results list (title, source badges — a joined doc shows **both** Zotero and
  Eagle badges; annotation snippet on match; tag chips); filter rail (sources, tags, collections
  tree); source-status header (unavailable → "Launch Eagle" action); "Sync now"; "Rebuild index"
  (with confirm — it's cheap but not instant).
- **Open actions per result:** deep link (`shell.openExternal` on `zotero://`/`eagle://` URI —
  page-anchored when the hit is an annotation), open file with OS default (`shell.openPath`),
  reveal in Finder. (`obsidian://` joins when that connector lands.)
- **Views v0 (thin):** save current query+filters as a named View in `.astrolabe/views/*.json`;
  list + recall. (The full Views concept returns in v2; this is just persisted lenses.)

**Tiers:** search-request → SQL translation is Tier A (unit); lens rendering is Tier B (component
tests — **jsdom project enters vitest now**, its consuming moment); one new Playwright spec: launch →
type query → result visible → (deep-link click intercepted, not asserted into the OS). Preload
allowlist assertion updated.

**DoD — the checkpoint the roadmap calls Phase 1's payoff:** one search box over Zotero + Eagle
with boolean tag/collection filtering, annotation snippets, and jump-to-source. Daily-driver usable.
Doc 03/06 updated from code.

## Step 7 — Phase 1.5: interim agentic access (MCP server over the index)

**Commit:** `feat: mcp server over the index (interim agentic access)`

- `src/mcp/server.ts` — standalone Node process (run via `pnpm mcp:serve` / `tsx`), **stdio**
  transport, `@modelcontextprotocol/sdk`. Opens `index.db` **read-only** (separate connection;
  WAL makes concurrent reads safe while the app runs).
- Tools (thin wrappers over the same query modules Step 6 uses — extract those into
  `src/main/index-queries/` shared by IPC + MCP):
  - `search_library({q, tags?, collections?, sources?})` → ranked results + provenance URIs
  - `get_document(id)` → metadata, instances, tags, collections
  - `get_annotations(documentId | query)` → annotation text/comments with page anchors
  - `resolve_provenance(uri)` → openable target description
- Register in Claude Code/Desktop (`claude mcp add astrolabe -- pnpm --dir <repo> mcp:serve` or
  absolute `tsx` invocation — document both in the README).
- **What this buys:** grounded agentic Q&A over the whole library weeks before Alioth, with zero
  discovery-token burn — and these handlers are the **first draft of Alioth's context assembler**
  (same query → relevant-slice-with-provenance shape, Phase 3 consumes them).

**Tier A:** tool-input schemas + the query modules (already tested in Step 6 — only the MCP
adapter layer is new; keep it too thin to need much). **DoD:** in a fresh Claude Code session,
"what did I highlight about precision/recall?" answers from *your* Zotero annotations with
`zotero://` links, via the index, not tool-spelunking.

## Step 8 (Phase 1 close-out) — Obsidian connector

**Commit:** `feat(connector): obsidian vault sync`
Chokidar watcher (the contract's `watch()` finally consumed) + gray-matter frontmatter +
wiki-link/tag parsing → notes as documents (`obsidian://open?vault=…&file=…`), tags into the same
M:N, backlink pairs stored for Phase 2 edges. Tier A on parsing (fixtures: real vault samples).
Lens gains the third badge. **Phase 1 complete.**

---

## Acceptance matrix (sequencing law, ADR-0007)

| After step | You can personally… |
|---|---|
| 1–2 | see structured logs; data survives restart; packaged app still boots (ABI proven) |
| 3 | run "Rebuild index" (empty→empty, but the law is operational) |
| 4 | search your real Zotero annotations from a REPL/dev panel |
| 5 | see the same PDF unified across Eagle+Zotero (one document, two anchors) |
| 6 | **daily-drive it**: one search box, boolean filters, jump-to-source |
| 7 | ask Claude about your library, grounded, with provenance links |
| 8 | all three sources in one lens — Phase 1 done |

## Estimates & risks

~2.5–3.5 weeks part-time total (1: ½d · 2: 2–3d · 3: 2d · 4: 3–4d · 5: 2d · 6: 3–4d · 7: 1–2d ·
8: 1–2d). Top risks: **(a)** local-API `since`/pagination semantics differ from web API — timebox
verification first day of Step 4, fall back to full-walk + mtime diff; **(b)** Eagle file-path
resolution across library versions — verify against `/api/library/info` early in Step 5;
**(c)** better-sqlite3 ABI in packaged app — that's why Step 2 ends with `package:dir`;
**(d)** scope gravity toward reader/graph features inside the lens — the answer stays *no, link out*
(doc 06 standing risk).

## Decisions this spec makes (revisitable, recorded here)

Default workspace `~/Astrolabe/` (provisional D-INF-1); generic table-client + named channels split
(audit ceiling honored); jsdom enters at Step 6; MCP server as Phase 1.5 (roadmap updated in the
same commit as this spec); Eagle PDFs are first-class documents (pain-map).
