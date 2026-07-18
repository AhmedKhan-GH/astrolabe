# Folders — The Organization Primitive (Track A, part 1)

Status: ACTIVE — governs the first Track A build phase.
Date: 2026-07-18

Astrolabe's first user-owned organization primitive: **folders** — nested,
multi-membership groupings of documents that span Zotero, Eagle, and Obsidian.
Named in Eagle's vocabulary by decision (D-A1 below): Ahmed's Eagle habits are
the proven mental model; this spec ports the model above the apps rather than
reinventing it.

## 1. Position — what this builds on

The index already unifies **identity** (spine spec v2, docs/2026-07-17): a
*work* is one `documents` row keyed by content hash, with an **instance** per
library that holds a copy, annotations attached to instances, and wiki-linked
notes attached via the links table. What no layer unifies is **organization**:
"where does this live" currently has three per-app answers (Eagle folders,
Zotero collections, Obsidian's file tree), each blind to the others.

Folders are that missing layer, per decision **D-A2 (option C)**: organization
is **Astrolabe-owned and one-way**. The apps' native structures remain visible
as read-only facets (`collections` tables, merged tags); Astrolabe never
writes organization back into any app. A selective "export structure to app X"
gesture may exist later; it is out of scope here.

v1 precedent: virtual collections (docs/2026-07-10-lens-virtual-collections in
the archive) proved the storage pattern (files-as-truth + SQLite mirror). The
idea was right; its flatness and overlay UI were not. Folders supersede
virtual collections — the archived implementation is quarry material, not a
parallel feature.

## 2. The primitive

One JSON file per folder at `<workspace>/.astrolabe/folders/<slug>.json`:

```json
{
  "schemaVersion": 1,
  "name": "EEC 174 ABY",
  "parent": null,
  "members": [
    { "sha256": "ab41f0…" },
    { "library": "obsidian:/Users/ahmed/…/Vault", "key": "ECG notes.md" }
  ]
}
```

- `slug` — derived server-side from `name` (shared slugify, views precedent);
  the file basename and the stable address for IPC and parent refs.
- `parent` — another folder's slug, or null (root). See §3 nesting rules.
- `members` — ordered-as-filed list of **document references**, two shapes:
  - **Hash ref** `{ sha256 }` — for hash-identified documents (pdf, image,
    other). App-proof and rebuild-proof: the folder does not care which
    library holds the bytes, which is the point of organizing above the apps.
  - **Path ref** `{ library, key }` — for mutable notes (no hash identity,
    spine spec §1). `library` is the composite `connector:stableKey`;
    `key` is the instance externalKey (vault relpath).

File handling follows the views/reading precedent verbatim: zod-validated,
`schemaVersion` literal, atomic tmp+rename writes, a present-but-invalid file
is treated as absent with a warn (a hand-edit gone wrong must never take down
the app), directory created lazily.

**Reserved, deliberately absent in v1** (fields added later without
migration): sections/ordering beyond filed-order, per-member reading status,
pinned notes, icons/colors, smart-folder rules. Their absence is D-A4 (start
foolproof); their future home is this same file format.

## 3. Semantics

**Nesting.**
- A folder's `parent` may name any folder that is not itself or one of its
  descendants (cycle-guarded at write time; the write is rejected, never
  "fixed" silently).
- Re-parenting = editing one field; subtree moves are one file write.
- A `parent` naming a nonexistent slug renders at root with a warn (broken by
  hand-edit or partial sync of the folders dir; never fatal).
- Rail selection shows the folder's **own members** (Eagle's default), with a
  subtree roll-up count displayed and an "include subfolders" toggle on the
  river query.

**Multi-membership.**
- A document may be a member of any number of folders; membership lives only
  in folder files — nothing is stamped on the document.
- No primary folder; all memberships are equal.
- Adding an existing member is a no-op (refs dedupe on write; hash refs are
  equal by `sha256`, path refs by `(library, key)` — the two shapes never
  compare equal to each other).
- Removing a member touches nothing but that folder's file.
- Deleting a folder deletes the grouping only: members untouched, children
  re-parented to the deleted folder's parent (never orphaned, never cascaded —
  deleting a folder must not silently delete a subtree's *organization*
  either; the user deletes folders one at a time or moves them first).
- Per ADR-0001: no folder operation ever touches any app or any document.

**Reference resolution.**
- Hash ref → `documents.contentSha256`. Resolves to ghosts too (documents are
  permanent, spine §2) — a folder keeps remembering a work whose copies are
  gone; the ghost toggle governs its visibility, not its membership.
- Path ref → instance `(library.stableKey, externalKey)` → its document.
- An unresolved ref (document not yet scanned, vault renamed) is retained in
  the file and simply contributes nothing to the mirror until it resolves —
  same philosophy as unresolved wiki-links. Never pruned automatically.

## 4. The SQLite mirror

Files are truth; SQLite is the join engine. Two derived tables:

- `folders` — id, slug (unique), name, parentId (nullable, SET NULL).
- `folder_members` — folderId (CASCADE), documentId (CASCADE),
  unique(folderId, documentId).

Rebuilt **wholesale from the files** by `syncFolders(db)`: at boot, after
every folder write, and after every connector sync (membership resolution can
change when new documents arrive). The mirror is disposable; `wipeDerived`
drops it like every derived table and the next mirror pass restores it from
files. The mirror NEVER writes files. Row ids are not stable across rebuilds
— nothing outside SQL may hold a folder row id; the slug is the address
(rebuild-stable, vcollections precedent).

## 5. Wire contract

Channels (db-ipc, layer-free request schemas beside them; list/mutate all
return the full updated folder tree so the renderer holds one snapshot):

- `folders:list` → tree with per-folder own-count + subtree-count.
- `folders:create` `{ name, parent? }`.
- `folders:rename` `{ slug, name }` — slug is regenerated from the new name;
  the response carries the new slug (parent refs in child files are rewritten
  in the same transaction-equivalent pass).
- `folders:set-parent` `{ slug, parent }` — null = to root; cycle-rejected.
- `folders:delete` `{ slug }`.
- `folders:add-members` / `folders:remove-members` `{ slug, documentIds }` —
  main resolves ids → refs (hash-first, path for unhashed notes); the
  renderer never constructs refs.

## 6. Query integration

- `filterSetSchema` gains `folderSlugs?: string[]` (scope-union dimension,
  like libraryIds) and `includeSubfolders?: boolean` (default false, Eagle's
  default).
- **Uncategorized** — the Eagle affordance that makes filing a workflow:
  a predicate for "member of no folder", exposed as a rail row with count.
  It is the filing inbox.
- Rail payload: folder tree + counts, `All` count, `Uncategorized` count.
- Ghost interaction: unchanged — the anchored predicate applies inside folder
  scope like everywhere else; `includeGhosts` reveals a folder's ghosts.

## 6b. Seed import (D-A6) — lifting the Eagle taxonomy

One-time gesture: pick an Eagle library (or subtree). Each Eagle folder →
an Astrolabe folder (same name, same nesting); each member item → a member
ref on the corresponding *document* (hash-first — so an imported member
arrives already carrying its Zotero annotations and Obsidian backlinks).
Source of the tree: the already-synced `collections` tables + membership —
no new Eagle API surface.

- A copy, not a subscription: after import the trees are UNLINKED. The Eagle
  tree remains a read-only facet and may drift freely; the Astrolabe tree is
  canonical.
- Imports land under a fresh root folder named after the source library
  (e.g. "Books (imported)") — re-runnable without ever merging into folders
  curated since; the user re-parents/renames afterward as they wish.
- Items without a document match (unsynced/unhashed) become path refs where
  possible, else are skipped and counted; the gesture reports
  created/members/skipped.
- Generalizes to Zotero collections later; Eagle ships first (it is where
  the real taxonomy lives).
- Channel: `folders:import` `{ libraryId, rootName? }`.

## 7. Testing (Tier A — this is rule-enforcing logic)

TDD, mutation-checked at the load-bearing rules:
- Pure: slugify reuse, cycle detection (self, deep descendant), ref equality/
  dedupe, delete-reparents-children.
- itest (real sqlite + real files in tmp workspace): file write → mirror →
  query round-trip; wholesale re-mirror idempotency; unresolved ref
  contributes nothing then resolves after a (faked) scan; hash ref survives
  wipeDerived + re-mirror with renumbered ids; Uncategorized count;
  include-subfolders query; ghost-in-folder visibility under the toggle.
- Mutation checks: break the cycle guard → tests fail; drop the
  members-dedupe → tests fail.

## 8. Build order

1. **Folder store + mirror + queries** (this spec, no UI): lib/folders.ts
   (store), folder-mirror in the sync path, filterSet extension, channels +
   preload. Substrate only — ADR-0007 (phase ends usable) is satisfied at the
   Track A phase boundary, i.e. by step 2, not by this commit alone.
2. **The frame** (separate spec section, next): rail (All / Uncategorized /
   folder tree / tags / libraries), river scoping, document hub, filing
   gesture, ⌘K switcher. Folders become the way the app is entered.

## 9. Decisions record

- **D-A1** Eagle terminology adopted: Folders, Smart Folders (reserved),
  Tags, All, Uncategorized. No Trash (deletion lives in the source apps).
- **D-A2** Organization is Astrolabe-owned, one-way (option C): apps' native
  structures are read-only facets; selective export is a future gesture.
- **D-A3** Nested + multi-membership from v1 (Eagle parity); folders are
  files-as-truth with a disposable SQLite mirror.
- **D-A4** Foolproof v1 scope: membership + nesting only; ordering, status,
  sections, smart rules reserved as future fields of the same files.
- **D-A5** Members are document refs: hash-first, path refs for notes;
  unresolved refs retained, never auto-pruned.
- **D-A6** One-time seed import lifts a source tree (Eagle first) into
  Astrolabe folders under a fresh root; a copy, never a sync — trees are
  unlinked the moment the import completes.

## 10. Non-goals

- No write-back of organization into any app (D-A2; revisit as an explicit
  export gesture).
- No smart folders in v1 (name reserved; saved-views machinery is quarry).
- No trash/delete of documents from folders UI — ADR-0001 stands.
- No per-member annotations of any kind in v1 (D-A4).
