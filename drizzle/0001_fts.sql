-- FTS5 over the index (v1's 0002_fts, quarried). One row per document, rowid =
-- documents.id. Maintained by application code inside the same transaction as
-- document upserts (src/main/index/upsert.ts) — title, body (annotation
-- text/comments + extracted text later), and flattened tag names. Ghost
-- documents KEEP their FTS row (spec §2) — default search hides them via the
-- anchored predicate, the toggle reveals them.
CREATE VIRTUAL TABLE `search_fts` USING fts5(
  `title`,
  `body`,
  `tags`,
  tokenize = 'porter unicode61'
);
