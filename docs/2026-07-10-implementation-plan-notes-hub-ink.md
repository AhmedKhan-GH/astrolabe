# Implementation Plan: Notes → Document Hub → GoodNotes Ink

**Date:** 2026-07-10 · **Status:** current working plan (supersedes the wave list discussed in-session)
**Explicitly OUT of scope until revisited:** graphify (connector, concepts surfaces), all
agentic/AI functionality (ACP client, dialogue, OCR), Eagle↔Zotero write gestures (research
stands in docs/2026-07-10-zotero-write-path-research.md; deferred, not dropped).

Ordering is dependency-driven: the hub composes what the notes wave builds; ink ingestion is
independent but benefits from the hub existing (an ink notebook is just another document there).

---

## Step 1 — Notes (spec: docs/2026-07-10-notes-view-links-spec.md; in flight)

1. **Obsidian deep-link fix** — `obsidian://open?path=<encoded absolute path>` (verified
   working; the `file=`+`%2F` form is broken). Rebuild backfills stored URIs.
2. **Links table** — human wiki-link edges materialized at sync (already parsed, currently
   dormant in metaJson); `resolveLinks` re-pass after sync/rebuild; `index:links` channel
   (outlinks + backlinks per document).
3. **NoteView** — react-markdown + remark-gfm read-only panel; live wiki-links (click →
   navigate in-app), backlinks section, tag chips, "open in Obsidian ↗". Entry from river +
   search note titles. Obsidian stays the editor and fidelity renderer.

## Step 2 — Document Hub

One panel per document composing ONLY existing index data (no new intelligence):

- **Wire:** one channel `index:document` `{documentId}` → everything the hub shows in one
  round-trip: document core (title/kind/tags/modifiedAt/hash presence), instances (with
  openPdfUri/filePath), annotation summary (count + per-page counts, reusing pageAnnotations),
  backlinking notes (links table), virtual-collection memberships.
- **UI:** `DocumentHub.tsx` panel (same overlay family): header (title, kind, tags, VC chips);
  Sources section (per-instance jump-out / open file / reveal, presence statement for
  zotero/eagle); Annotations section (total + top annotated pages, "open canvas" if pdf);
  Notes section (backlinks, click → NoteView); actions row (Canvas / Note view as applicable).
- **Entry:** an info affordance on river + search rows (distinct from the title-click which
  keeps opening Canvas/NoteView directly); NoteView backlink rows and Canvas header link here
  too. Hub, Canvas, and NoteView are one mutually-exclusive panel slot.

## Step 3 — GoodNotes ink ingestion (no OCR — deferred with AI scope)

GoodNotes' auto-backup exports notebooks as PDFs to a cloud folder; that folder is the
ingestion surface. GoodNotes remains the system of record and sole editor of ink.

1. **Config:** `connectors.goodnotes.backupPath` in the workspace manifest (same pattern as
   the obsidian vault path).
2. **Connector `goodnotes`** (4th source): walk backupPath for `*.pdf`, reference in place
   (filePath = backup file; no copy in v1 — the backup IS a stable managed export; revisit
   copy-into-`.astrolabe/ink/` if GoodNotes churn proves disruptive), externalKey = relpath,
   contentSha256 hash (identity + dedupe), kind 'pdf', title = filename sans extension,
   mtime watermark cursor + chokidar watch (obsidian connector is the template).
3. **Source-key plumbing:** `sourceKey` enums in filterSetSchema / renderer types / rail grow
   `'goodnotes'`; presence facet stays zotero/eagle-only by design. Access probe path =
   backupPath (iCloud/Drive folders are TCC surfaces).
4. **Payoff with zero extra UI:** notebooks appear in the river/search/facets like any PDF,
   and **Canvas works on them immediately** — a handwritten notebook at a glance. Searchable
   content arrives only when OCR lands (deferred); until then titles/paths/tags carry search.

## Standing constraints

- Every step: TDD per CLAUDE.md, spec before dispatch, parallel Opus subagents for
  implementation, full suite (typecheck + unit + integration + e2e) before commit,
  `pnpm dev:install:mac` after each landed step.
- No new first-party stores: links/hub read paths are derived; ink v1 references files.
