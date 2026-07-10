import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { cpSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { and, asc, eq } from 'drizzle-orm'
import { openDb, type DbHandle } from '../../db'
import * as s from '../../db/schema'
import { createUpsertApi, type UpsertApi } from '../../index/upsert'
import { createIndexQueries, type IndexQueries } from '../../index/queries'
import type { SyncContext } from '../types'
import { createObsidianConnector } from './index'

/**
 * Tier A integration: the Obsidian connector against real SQLite + real migrations +
 * a real synthetic vault on disk (the __fixtures__/vault mini-vault copied to a temp
 * dir, so parsing is exercised against realistic note files). We prove: notes land as
 * `note` documents with obsidian:// provenance; note BODY is searchable through FTS
 * (the annotation→body deviation); hidden dirs (.obsidian/.trash) are skipped; the
 * mtime watermark skips unchanged files; and a changed file re-upserts IN PLACE.
 */
let dir: string
let vaultPath: string
let handle: DbHandle
let upsert: UpsertApi
let queries: IndexQueries

const FIXTURE_VAULT = fileURLToPath(new URL('./__fixtures__/vault', import.meta.url))

/** Force a deterministic mtime (ms) so the watermark logic is testable. */
function setMtime(relPath: string, ms: number): void {
  const when = new Date(ms)
  utimesSync(join(vaultPath, relPath), when, when)
}

function ctx(cursor: string | null): SyncContext {
  return { db: handle.db, upsert, cursor }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'astrolabe-obsidian-'))
  vaultPath = join(dir, 'MyVault')
  cpSync(FIXTURE_VAULT, vaultPath, { recursive: true })
  // Pin every fixture note to a known baseline mtime.
  for (const rel of [
    'frontmatter-tags.md',
    'inline-tags.md',
    'wikilinks.md',
    'no-frontmatter.md',
    'projects/nested-note.md',
  ]) {
    setMtime(rel, 1_000_000)
  }
  handle = openDb(join(dir, 'index.db'))
  upsert = createUpsertApi(handle.db)
  queries = createIndexQueries(handle.db)
})
afterEach(() => {
  handle.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('obsidian scan — notes land as documents', () => {
  it('indexes every .md as a note, skips hidden dirs, advances the watermark', async () => {
    const conn = createObsidianConnector({ vaultPath })
    const result = await conn.scan(ctx(null))

    // 5 notes under the vault; .obsidian/app.json and .trash/old.md are NOT indexed.
    expect(result.documentsUpserted).toBe(5)
    expect(result.annotationsUpserted).toBe(5)
    expect(result.cursor).toBe('1000000')

    // The trashed note (#gone / "deleted note") must be absent from the index.
    expect(queries.search({ q: 'deleted' })).toHaveLength(0)
  })

  it('exposes note kind + obsidian://open?path= provenance uri (encoded absolute path)', async () => {
    await createObsidianConnector({ vaultPath }).scan(ctx(null))

    const hits = queries.search({ q: 'Reading List' }) // wikilinks.md frontmatter title
    expect(hits).toHaveLength(1)
    expect(hits[0]?.kind).toBe('note')
    // The path= form (encoded ABSOLUTE file path) — verified working against the live vault;
    // per Obsidian's URI docs `path` overrides vault+file (the old vault=+file= form broke on
    // nested notes).
    expect(hits[0]?.instances[0]?.uri).toBe(
      `obsidian://open?path=${encodeURIComponent(join(vaultPath, 'wikilinks.md'))}`,
    )

    const nested = queries.search({ q: 'recursive vault walking' })
    expect(nested[0]?.instances[0]?.uri).toBe(
      `obsidian://open?path=${encodeURIComponent(join(vaultPath, 'projects/nested-note.md'))}`,
    )
  })

  it('emits link rows for every wiki-link target, deduped, in note order (ORDER BY id)', async () => {
    await createObsidianConnector({ vaultPath }).scan(ctx(null))

    const src = handle.db.select().from(s.sources).where(eq(s.sources.key, 'obsidian')).get()!
    const instance = handle.db
      .select()
      .from(s.documentInstances)
      .where(and(eq(s.documentInstances.sourceId, src.id), eq(s.documentInstances.externalKey, 'wikilinks.md')))
      .get()!
    const rows = handle.db
      .select({ targetName: s.links.targetName, targetDocumentId: s.links.targetDocumentId })
      .from(s.links)
      .where(eq(s.links.sourceInstanceId, instance.id))
      .orderBy(asc(s.links.id))
      .all()
    // wikilinks.md: alias + heading refs strip to the bare target; the ![[embed]] counts; the
    // second [[Deep Learning]] mention does not duplicate. Rows land unresolved (NULL) — the
    // resolveLinks re-pass is the resolver, not the connector.
    expect(rows).toEqual([
      { targetName: 'Deep Learning', targetDocumentId: null },
      { targetName: 'Attention Is All You Need', targetDocumentId: null },
      { targetName: 'Neural Networks', targetDocumentId: null },
      { targetName: 'architecture-diagram.png', targetDocumentId: null },
    ])
  })

  it('makes note BODY searchable via FTS (the annotation→body deviation)', async () => {
    await createObsidianConnector({ vaultPath }).scan(ctx(null))
    // "coupling constants" appears only in the BODY of frontmatter-tags.md.
    const hits = queries.search({ q: 'coupling constants' })
    expect(hits).toHaveLength(1)
    expect(hits[0]?.title).toBe('Quantum Field Theory Notes')
  })

  it('folds frontmatter + inline tags onto the document', async () => {
    await createObsidianConnector({ vaultPath }).scan(ctx(null))
    const hits = queries.search({ q: 'physics' }) // frontmatter tag → FTS tags column
    expect(hits).toHaveLength(1)
    expect(hits[0]?.tags).toEqual(
      expect.arrayContaining(['physics', 'quantum', 'field-theory', 'renormalization']),
    )
  })
})

describe('obsidian scan — incremental watermark', () => {
  it('re-scan from cursor with no changes upserts nothing', async () => {
    const conn = createObsidianConnector({ vaultPath })
    const first = await conn.scan(ctx(null))
    const second = await conn.scan(ctx(first.cursor))
    expect(second.documentsUpserted).toBe(0)
    expect(second.cursor).toBe(first.cursor)
  })

  it('a changed file re-upserts IN PLACE; unchanged files are skipped', async () => {
    const conn = createObsidianConnector({ vaultPath })
    const first = await conn.scan(ctx(null))
    expect(queries.search({ q: 'Somewhere' })).toHaveLength(1) // original no-frontmatter body

    // Rewrite one note with new content and a newer mtime.
    writeFileSync(join(vaultPath, 'no-frontmatter.md'), 'Rewritten note now about photosynthesis and chloroplasts.\n')
    setMtime('no-frontmatter.md', 2_000_000)

    const second = await conn.scan(ctx(first.cursor))
    expect(second.documentsUpserted).toBe(1) // only the changed note
    expect(second.cursor).toBe('2000000')

    // New body searchable; old body gone (in-place replacement, not a duplicate).
    const rewritten = queries.search({ q: 'photosynthesis' })
    expect(rewritten).toHaveLength(1)
    expect(queries.search({ q: 'Somewhere' })).toHaveLength(0)

    // Still exactly one note document for that path (no duplicate instance).
    expect(rewritten[0]?.instances).toHaveLength(1)
    expect(rewritten[0]?.instances[0]?.uri).toBe(
      `obsidian://open?path=${encodeURIComponent(join(vaultPath, 'no-frontmatter.md'))}`,
    )
  })
})

describe('obsidian checkAvailable', () => {
  it('true for an existing vault dir', async () => {
    const res = await createObsidianConnector({ vaultPath }).checkAvailable()
    expect(res.available).toBe(true)
  })

  it('false + launch hint when the vault path is missing/unset', async () => {
    const missing = await createObsidianConnector({ vaultPath: join(dir, 'nope') }).checkAvailable()
    expect(missing.available).toBe(false)
    expect(missing.launchHint).toContain('vaultPath')

    const unset = await createObsidianConnector({ vaultPath: null }).checkAvailable()
    expect(unset.available).toBe(false)
  })
})
