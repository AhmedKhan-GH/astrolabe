# Note Rename Healing — Identity Hardening 1

Status: ACTIVE — governs the rename-healing build.
Date: 2026-07-19

Mutable notes are path-identified (spine spec v2 §1), so renaming/moving a
note in Obsidian changes its identity: today the old instance is swept (its
document ghosts), a fresh document appears at the new path, and any folder
path-refs to the old path dangle. This spec heals renames at sync time so
**continuity (same document row, folder membership) survives a rename with
zero user discipline**.

## 1. The rename hint (connector contract extension)

- `LibraryDocumentInput` gains `renameHint?: string` — an opaque
  content-derived fingerprint. A connector that emits it MUST also persist it
  inside the instance's `metaJson` under the key `renameHint` (sync reads OLD
  hints from `instances.metaJson`, incoming hints from the scan payload).
- Obsidian connector: hint = sha256 hex of the note's raw file content
  (computed during the scan read it already performs; node:crypto, no new
  deps). Zotero/Eagle emit no hint — hash-identified documents don't need
  healing (their keys are stable and identity is the content hash).

## 2. Healing pass (sync.ts, generic, per scanned library)

Runs BEFORE the library's upsert loop, only when `!unchanged` and
`allExternalKeys` is present (never heal on partial knowledge):

- `removed` = indexed instances of this library whose externalKey ∉
  allExternalKeys AND whose metaJson carries a `renameHint`.
- `added` = scan documents whose externalKey has NO instance in this library
  AND which carry a `renameHint`.
- Pair on hint equality **only when the hint maps to exactly one removed,
  exactly one added, AND is carried by no surviving instance** (the
  survivor-hint guard: a duplicate-content twin still present makes the hint
  ambiguous — healing could transfer identity to a copy — so nothing heals
  and normal sweep semantics apply). [Amended 2026-07-19: the original
  "exactly one removed + one added" wording contradicted §4's duplicate-twin
  example; the implementer caught it and the survivor guard — a strict
  narrowing — is the adopted resolution.] Renamed-AND-edited in one
  interval → hints differ → no heal (a future frontmatter-id anchor may
  cover this; out of scope, recorded in §5).
- Heal = UPDATE the existing instance row in place: externalKey → new,
  uri/filePath/metaJson → incoming values. The document row is UNTOUCHED —
  same documentId, so everything document-anchored survives by construction.
  The subsequent upsert loop then finds the instance at (library, newKey)
  and proceeds as a normal update; the removal sweep sees nothing stale.
- Each heal emits `{ library: '<connectorKey>:<stableKey>', oldKey, newKey }`
  via a new optional `syncConnector` argument
  `opts?: { onInstanceRenamed?: (ev) => void }`, and is logged.

## 3. Folder path-ref rewrite (store + wiring)

- `FoldersStore.renamePathRefs(library: string, oldKey: string, newKey:
  string): number` — rewrites every matching path ref across all folder
  files (atomic per-file writes, returns rewritten count). If the target ref
  already exists in the same folder, the old ref is dropped instead of
  duplicated (ref-equality dedupe preserved).
- main/index.ts wires `onInstanceRenamed` → `foldersStore.renamePathRefs`;
  the existing post-sync `syncFolders` re-mirror picks up the change. No new
  channels.

## 4. Testing (Tier A, TDD, mutation-checked at the pairing rule)

- obsidian connector: scan emits renameHint on every note, persisted in
  metaJson.
- sync itest (fake connector, real sqlite): rename → SAME documentId, no
  ghost, instance key/uri/path updated, onInstanceRenamed fired once;
  ambiguity (two identical-content notes, one renamed) → NO heal (old
  ghosts, new document — safe default); renamed+edited → no heal; heal
  respects library scoping (identical hint in a different vault never
  pairs).
- folders itest: renamePathRefs rewrites across files, dedupes when target
  exists, touches nothing else; end-to-end: filed note → rename → sync
  heal → membership intact in mirror queries.
- Mutation check: break the exactly-one-pair rule (pair on any match) →
  the ambiguity test must fail.

## 5. Non-goals / recorded futures

- No frontmatter-id anchoring yet (would survive rename+edit; needs
  Zettelkasten templating buy-in — future "identity hardening 2").
- No healing for hash-identified documents (unnecessary), no cross-library
  healing (a note moved BETWEEN vaults is genuinely a new instance).
- Binary content drift (edited PDFs splitting a merge) is a separate,
  Track-B-adjacent problem — not addressed here.
