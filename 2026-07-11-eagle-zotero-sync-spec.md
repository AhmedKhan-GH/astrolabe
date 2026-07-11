# Eagle↔Zotero Sync Gestures — Design Spec

**Date:** 2026-07-11 · **Status:** approved for implementation (precedes the ACP project —
proves the write-back plumbing on deterministic code before any agent touches it)
**Research basis:** docs/2026-07-10-zotero-write-path-research.md (connector-server decision)
**Model:** Zotero is a curated SUBSET of Eagle (user decision, 2026-07-10): Eagle = library /
organization truth, Zotero = annotation workspace. Gestures move documents both ways on
demand; nothing moves automatically. Astrolabe copies bytes INTO a system of record via that
system's own API — it never manages files itself (docs/00 inviolable principle).

## Gestures

1. **Promote to Zotero** — an Eagle-only PDF becomes a Zotero item + attached PDF ("I want to
   read/annotate this"). Zotero stores its own copy (it remains system of record for that copy).
2. **Import to Eagle** — a Zotero-only PDF joins the Eagle library ("research led into the
   library"). Eagle copies the file into its `.library` store.

After either gesture, an incremental sync of the TARGET source runs; content-hash identity
then merges the new instance into the SAME document row → the presence facet flips to
`both` with no further bookkeeping. The hash join is the correctness mechanism, not UI polish.

## Main-process services

### `src/main/lib/zotero-write.ts` (+ unit tests for payload builders)
Connector-server client per the research note, injectable fetch for tests:
- `getSaveTargets()` → POST `/connector/getSelectedCollection` → editable collections.
- `promoteDocument(doc)`:
  1. POST `/connector/saveItems` — sessionID = uuid; item shape: `{id:'itm1',
     itemType:'document'|'journalArticle' (v1: 'document' — no metadata guessing), title,
     tags:[{tag}] from the document's tags}`.
  2. POST `/connector/saveAttachment` — `X-Metadata: {sessionID, parentItemID:'itm1', title}`,
     `Content-Type: application/pdf`, body = the instance file's raw bytes (streamed).
  3. v1 lands in Zotero's currently-selected collection (no `updateSession` targeting; a
     target-collection picker is a later nicety).
- Do NOT send `X-Zotero-Connector-API-Version`. Distinguish errors: ECONNREFUSED → "Zotero
  isn't running"; non-2xx → surfaced with body text.

### `src/main/lib/eagle-write.ts` (+ unit tests)
- `importDocument(doc)` → POST `:41595/api/item/addFromPath` `{path: <zotero instance
  filePath>, name: doc.title, tags: doc.tags, website: 'zotero://select/library/items/<key>'}`
  (back-link to the Zotero item). ECONNREFUSED → "Eagle isn't running".

## Wire contract

One channel `reconcile:transfer` (db-ipc.ts):
```ts
transferRequestSchema = { documentId: id, direction: z.enum(['to-zotero', 'to-eagle']) }
→ { ok: true } | { ok: false; reason: string }   // reason is user-renderable
```
Handler (index.ts): load document + instances; **idempotence gate** — refuse when the target
source already has an instance for this document (presence already covers it) or when the
document has no file-backed source instance; dispatch to the service; on success run the
target connector's incremental sync + resolveLinks + vcollections re-mirror (existing
post-sync block); return. Preload: `reconcile.transfer(documentId, direction)` under the
existing top-level `index`-adjacent surface — NO new top-level key (e2e allowlist stable;
put it on `window.astrolabe.index.transfer`).

## Renderer

- **Where:** the Document Hub's Sources section (primary home — presence statement sits
  there already) and the river/search row's instance badge strip (compact icon button).
- **Affordance rule:** pdf + file-backed + presence `eagle-only` → "→ Zotero"; presence
  `zotero-only` → "→ Eagle". Presence `both`/`none`/non-pdf → nothing. Same optional-prop
  pattern as every other affordance (unwired = absent, tests mirror the canvas suites).
- **States:** pending (button disabled, "sending…"), success (invalidate browse/search/nav/
  document queries — presence flips visibly), failure (inline red reason: "Zotero isn't
  running — open it and retry").

## Testing (TDD; stakes × logic)

- **Unit:** payload builders (item shape, tags mapping, X-Metadata header, back-link URI);
  error mapping (ECONNREFUSED → friendly reason); idempotence gate logic.
- **Integration (mock server):** zotero-write + eagle-write against a local http fixture
  asserting exact requests (paths, headers, body framing; PDF bytes streamed not JSON'd);
  handler flow against real SQLite: gate refusals (already-both, no file), success path
  marks nothing in OUR db directly (the sync does).
- **Live pin (manual gate):** one integration test tagged `itest.live` (skipped unless
  `ASTROLABE_LIVE_ZOTERO=1`) that promotes a throwaway PDF against a running Zotero — the
  connector protocol is Zotero-internal, so this is the canary to re-run on Zotero upgrades.
- **Component:** hub + row affordance suites (presence-conditional rendering, pending,
  failure reason line).

## Out of scope (recorded)

- Automatic/bulk mirroring (selective by design; bulk multi-select is a later ergonomic).
- Metadata enrichment on promote (DOI lookup etc. — Zotero's own retrieve-metadata does this
  better post-promote; agent-assisted enrichment belongs to the ACP era).
- Target collection picker; Web-API fallback for cloud-only users (research note documents it).
- Deletions/moves in either direction — reconciliation of removals stays rebuild-only (v1).
