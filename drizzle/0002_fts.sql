-- FTS5 over the index (runway step 3). One row per document, rowid = documents.id.
-- Maintained by application code inside the same transaction as document upserts
-- (src/main/index/upsert.ts) — title, body (annotation text/comments + extracted
-- text later), and flattened tag names.
CREATE VIRTUAL TABLE `search_fts` USING fts5(
  `title`,
  `body`,
  `tags`,
  tokenize = 'porter unicode61'
);
