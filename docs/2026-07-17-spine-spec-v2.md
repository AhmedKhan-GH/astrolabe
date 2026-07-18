# Spine Spec v2 — Identity, Presence, and the Reading Ledger

Status: ACTIVE — governs the rebuild skeleton (Phase S) and M3.
Date: 2026-07-17

This spec supersedes the v1 index schema's identity model. It exists because two
questions had no principled answer in v1:

1. **What happens when a tool changes libraries in situ?** Zotero, Eagle, and
   Obsidian can each swap the entire visible corpus (group libraries, Eagle
   library switch, different vault). v1 modeled one library per connector and
   interpreted a library switch as mass deletion (`removals.ts` diffed the scan
   against *all* of a connector's instances).
2. **What does the index owe a document over time?** v1 pruned orphaned
   documents; reading history survived only by accident of being hash-keyed
   files. "Build the mind once, query it forever" (docs/00) demands permanence
   by design, not accident.

## 1. Identity — three levels

```
connector (zotero | eagle | obsidian)
  └── library   (a corpus the connector can see: stable key + availability)
        └── instance  (one document as one library holds it)
document — cross-library entity, keyed by content
```

- **Connector**: capability + status. What v1 called `sources`.
- **Library**: NEW first-class entity, `(connector, stableKey)`:
  - Zotero: `libraryID` — the personal library AND each group library
    (D2: groups are real and scanned, not merely modeled).
  - Eagle: the library path (`/library/info`).
  - Obsidian: the vault path; the workspace manifest holds a *list* of vaults.
  - Columns: display name, availability (`live | dormant | gone`), lastSeenAt,
    lastScanAt.
- **Instance**: belongs to a library, unique on `(libraryId, externalKey)`.
  Carries provenance URI, file path, source metadata.
- **Document**: the cross-source entity. Identity rules by mutability:
  - Immutable binaries (pdf, image): `contentSha256`. The hash-join that merges
    a file held in two tools into one document (the Zotero↔Eagle pain-killer)
    is unchanged and now spans N libraries.
  - Mutable notes (markdown): identity is `(library, relpath)`; the hash is a
    version marker for change detection, never identity.

## 2. Presence semantics — the library-switch rules

- **Scans are library-scoped.** A scan names the library it observed. Upserts
  and removal sweeps apply only within that library's instances.
- **Unreachable ≠ deleted.** A library that cannot be reached (Eagle has a
  different library open; vault unmounted; drive unplugged) becomes `dormant`.
  Nothing under it is deleted — ever — by absence-due-to-unreachability.
- **An instance dies only when a live scan of its own library omits it.**
- **Dormant can still be readable.** File paths are per-instance; a dormant
  Eagle library's folder usually still exists on disk. Availability is checked
  at the file level (does the path resolve), not at the app level (is it open).
- **Documents are permanent.** A document is never deleted by sync. With zero
  live instances it becomes a **ghost**: retained with its full reading
  history, hidden from all default surfaces, revealed by a single global
  toggle ("show ghosts") — one button, no per-view settings (D3).
- `gone` is a user verdict on a library (explicit "forget this library"), the
  only path that removes instances without a scan — and even that leaves
  documents (as ghosts) and their reading ledgers intact.

## 3. The reading ledger (lands in M3; shape frozen here)

v1's reading-state kept per-page running totals (dwell, visits, first/last
seen). Totals destroy visit history — Track L's spacing/forgetting-curve work
(docs/2026-07-12) needs *when each visit happened*.

- **Events are truth.** Append-only, session-stamped log per document, keyed by
  `contentSha256`, stored as user-owned files under `.astrolabe/reading/`
  (views precedent: schema-versioned, atomic writes, corrupt → treated absent).
  Event: `{sessionId, pageIndex, kind, dwellMs?, at}` where `kind` ∈
  `view | zoom | select | find-hit`.
- **Rollups are derived** and rebuildable from events: per-page exposure
  (v1's shape), per-TOC-section and per-document coverage, the unread frontier
  (never-seen page ranges), staleness (last-seen age).
- **Assertions are separate from observations.** Page/section marks are flags
  only: `read | skimmed | revisit | key` (D1). Document-level `finished`
  stays. Honest labels: observed data is *exposure/engagement*, never
  "understood"; asserted data is "you said so."
- **Anchoring:** everything keys on content hash → survives library switches,
  Eagle→Zotero promotion, and index rebuilds. A different edition (different
  hash) is a different document; edition linking is a Track B graph edge.

## 4. Decisions record

- **D1 — Content stays in the systems of record.** Annotations live in Zotero;
  whole-page/prose notes live in Obsidian. Astrolabe stores only lightweight
  page marks (flags above) — connections and intelligence, never content.
- **D2 — Zotero groups are scanned.** Personal + each group = separate
  libraries under the zotero connector, from day one.
- **D3 — Ghosts are hidden behind a single toggle.** Default surfaces show
  only documents with at least one non-`gone` instance.

## 5. Non-goals

- No annotation or prose authoring (ADR-0001; D1).
- No comprehension claims from telemetry (engagement only).
- No cross-edition identity inference in the spine (graph work, Track B).
- No automatic library discovery beyond what connectors expose; adding an
  Obsidian vault is an explicit manifest edit.

## 6. Skeleton scope (Phase S) vs deferred

Phase S implements: §1 identity, §2 presence semantics, zotero connector over
personal + group libraries, FTS queries, minimal shell. M3 implements: §3
ledger + coverage + marks, the Reader, `astro://`. The ghost toggle ships with
the first list surface (Phase S commit 11).
