# Multi-Library Reach — Obsidian Vaults + Eagle Switch

Status: ACTIVE — governs the multi-library build.
Date: 2026-07-19

Closes "Astrolabe sees everything I have": N Obsidian vaults via config, and
Eagle's other libraries via commanded switching (API verified live
2026-07-19: `GET /api/library/history` enumerates known libraries;
`POST /api/library/switch {libraryPath}` works).

## A. Obsidian multi-vault (config gap only — engine already multi-vault)

- `workspace.ts` manifest schema: `connectors.obsidian` gains
  `vaultPaths: string[]` (optional) beside the existing singular
  `vaultPath`. Resolution: `vaultPaths` wins when present; else singular
  wrapped; else []. Normalize (strip trailing slashes) + dedupe.
- Obsidian connector's `manifestVaultPaths()` reads the new field; the
  LAUNCH_HINT mentions both forms. No other connector changes — each vault
  already becomes its own library (stableKey = path).
- Tests: schema accepts singular-only / plural-only / both (plural wins);
  normalization dedupes `x` vs `x/`; connector itest already covers
  multi-vault scan via injected paths — add one for manifest-driven plural
  resolution (tmp workspace via ASTROLABE_WORKSPACE env).

## B. Eagle library switching (the rail becomes Eagle's control surface)

**Client** (`eagle/client.ts`): `knownLibraries(): Promise<string[]>`
(`/library/history`, normalize trailing slashes + dedupe — the live probe
showed `Stanford Summer.library/` AND `Stanford Summer.library`);
`switchLibrary(path): Promise<void>` (`POST /library/switch`, JSON body,
throws on non-success).

**Switch-and-sync** (main): new module `src/main/index/eagle-switch.ts`:
- `switchAndSync(target)`: normalize target → POST switch → **wait-ready
  poll**: every 500ms (max 30s) until `/library/info` path (normalized)
  equals target; then one `/item/list?limit=1` success; 500ms settle →
  `syncConnector(eagle)` → return its SyncOutcome. Timeout → clear error,
  no sync, Eagle left as-is (user can see Eagle's own UI).
- `syncAllLibraries()`: remember current path → for each known library
  (current FIRST — cheapest, no switch — then the rest): switchAndSync;
  per-library failures recorded, loop continues → finally restore the
  original library (switch + wait, even after failures) → return
  `{ outcomes: {library, ok, error?, synced?}[], restored: boolean }`.
- Doctrine: BOTH are explicit user gestures only — switching visibly
  changes Eagle's open UI; never automatic, never scheduled (disruption
  spent deliberately). Serialize: one switch operation at a time (a simple
  in-flight guard; concurrent request → clear error).

**Wire** (db-ipc + main + preload): `eagle:libraries` →
`{ current: string|null, known: string[] }`; `eagle:switch`
`{ libraryPath }` → SyncOutcome; `eagle:sync-all` → the summary above.
Request schema layer-free in db-ipc; preload exposes
`astrolabe.eagle.{libraries, switch, syncAll}`.

**Rail** (`frame/rail/` Libraries section):
- Dormant Eagle library rows: a "switch & sync" affordance (icon button,
  title explains it opens the library in Eagle) → `eagle.switch`, busy
  state while running, tree/river refresh on completion.
- Section affordance "Sync all Eagle libraries" (beside Import): confirm
  step (it drives Eagle through every library, ~seconds each), progress
  ("2/3 Research…"), summary line on completion. Refresh after.
- Known-but-never-scanned libraries (in history, not in index) appear as
  faint rows with the switch affordance — that's how Research and
  Stanford Summer get their first index.

**Safety by construction:** the library-scoped sweep + dormant semantics
make any switch order lossless (fenced by existing tests); sync-all
inherits that. No new deletion paths.

**Tests:** client unit (history normalization/dedupe; switch POST shape);
eagle-switch itest with a scripted fake client (wait-ready polls until
ready; timeout error; sync-all visits all + restores original after a
mid-loop failure; in-flight guard rejects concurrent); rail component tests
(dormant row shows affordance; sync-all confirm + summary). Mutation check:
break restore-on-failure (skip finally) → the sync-all failure test fails.

## Non-goals

- No automatic/background switching, no scheduling.
- No Eagle multi-library simultaneous reads (Eagle's API ceiling — one open
  library; dormant records + on-disk files already bridge it).
- No vault auto-discovery UI (manifest edit is the v1 path; a discovery
  gesture can come with a settings surface later).
