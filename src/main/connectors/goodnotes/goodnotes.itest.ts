import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { openDb, type DbHandle } from '../../db'
import * as s from '../../db/schema'
import { createUpsertApi, type UpsertApi } from '../../index/upsert'
import { createIndexQueries, type IndexQueries } from '../../index/queries'
import { sha256File } from '../../lib/hash'
import type { SyncContext } from '../types'
import { createGoodnotesConnector } from './index'

/**
 * Tier A integration: the GoodNotes connector against real SQLite + real migrations +
 * a real temp backup folder of PDF files. We prove: each PDF lands as a `pdf` document
 * with goodnotes provenance + a content hash; hidden dirs are skipped; the mtime
 * watermark skips unchanged files and a changed file re-upserts in place; and — the
 * load-bearing claim — a notebook whose bytes already exist as an Eagle instance
 * merges into ONE document (the hash join), so ink joins the library.
 */
let dir: string
let backupPath: string
let handle: DbHandle
let upsert: UpsertApi
let queries: IndexQueries

/** Write a PDF file with given bytes and a deterministic mtime (ms) for watermark tests. */
function writePdf(relPath: string, bytes: string, mtimeMs: number): string {
  const full = join(backupPath, relPath)
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(full, bytes)
  const when = new Date(mtimeMs)
  utimesSync(full, when, when)
  return full
}

function ctx(cursor: string | null): SyncContext {
  return { db: handle.db, upsert, cursor }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'astrolabe-goodnotes-'))
  backupPath = join(dir, 'GoodNotes')
  mkdirSync(backupPath, { recursive: true })
  handle = openDb(join(dir, 'index.db'))
  upsert = createUpsertApi(handle.db)
  queries = createIndexQueries(handle.db)
})
afterEach(() => {
  handle.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('goodnotes scan — notebooks land as pdf documents', () => {
  it('indexes each pdf as a pdf with goodnotes provenance + a content hash, skipping hidden dirs', async () => {
    writePdf('Physics 101.pdf', '%PDF-fake-physics', 1_000_000)
    writePdf('Math/Calculus.pdf', '%PDF-fake-calc', 1_000_000)
    // A hidden dir (an iCloud/.Trash-style folder) must be skipped.
    writePdf('.Trash/old.pdf', '%PDF-fake-old', 1_000_000)

    const result = await createGoodnotesConnector({ backupPath }).scan(ctx(null))
    expect(result.documentsUpserted).toBe(2)
    expect(result.annotationsUpserted).toBe(0)
    expect(result.cursor).toBe('1000000')

    const hits = queries.browse({ kinds: ['pdf'] }).hits
    const physics = hits.find((h) => h.title === 'Physics 101')!
    expect(physics.kind).toBe('pdf')
    expect(physics.instances[0]?.sourceKey).toBe('goodnotes')
    expect(physics.instances[0]?.uri).toBe('goodnotes://Physics 101.pdf')
    // Nested relpath is normalized with forward slashes.
    const calc = hits.find((h) => h.title === 'Calculus')!
    expect(calc.instances[0]?.uri).toBe('goodnotes://Math/Calculus.pdf')

    // A content hash was stored (the trashed file never made it in).
    const docRow = handle.db.select().from(s.documents).where(eq(s.documents.title, 'Physics 101')).get()!
    expect(docRow.contentSha256).toBe(await sha256File(join(backupPath, 'Physics 101.pdf')))
    expect(queries.browse({ kinds: ['pdf'] }).total).toBe(2)
  })

  it('watermark skips unchanged files; a changed file re-upserts in place', async () => {
    const conn = createGoodnotesConnector({ backupPath })
    writePdf('Notebook.pdf', '%PDF-v1', 1_000_000)
    const first = await conn.scan(ctx(null))
    expect(first.documentsUpserted).toBe(1)

    // No change → nothing re-upserted, cursor stable.
    const second = await conn.scan(ctx(first.cursor))
    expect(second.documentsUpserted).toBe(0)
    expect(second.cursor).toBe(first.cursor)

    // Rewrite the same relpath with newer bytes + a newer mtime.
    writePdf('Notebook.pdf', '%PDF-v2-more-pages', 2_000_000)
    const third = await conn.scan(ctx(first.cursor))
    expect(third.documentsUpserted).toBe(1)
    expect(third.cursor).toBe('2000000')

    // Still exactly one document/instance for that relpath (in-place, no duplicate).
    const pdfs = queries.browse({ kinds: ['pdf'] })
    expect(pdfs.total).toBe(1)
    expect(pdfs.hits[0]?.instances).toHaveLength(1)
    // The hash updated to the new bytes.
    const doc = handle.db.select().from(s.documents).where(eq(s.documents.title, 'Notebook')).get()!
    expect(doc.contentSha256).toBe(await sha256File(join(backupPath, 'Notebook.pdf')))
  })

  it('a notebook whose bytes already exist in Eagle merges into ONE document (hash join)', async () => {
    // Seed an Eagle instance for a scanned notebook already in the library.
    const bytes = '%PDF-identical-notebook-bytes'
    const eagleFile = join(dir, 'eagle-copy.pdf')
    writeFileSync(eagleFile, bytes)
    const sha = await sha256File(eagleFile)
    upsert.upsertDocument({
      sourceKey: 'eagle',
      externalKey: 'EAGLE-ITEM-1',
      uri: 'eagle://item/EAGLE-ITEM-1',
      title: 'Lecture Notes (scanned)',
      kind: 'pdf',
      filePath: eagleFile,
      contentSha256: sha,
      modifiedAt: 500_000,
    })

    // GoodNotes backs up the SAME notebook (identical bytes → identical hash).
    writePdf('Lecture Notes.pdf', bytes, 1_000_000)
    await createGoodnotesConnector({ backupPath }).scan(ctx(null))

    // The merge itself is the proof: the identical bytes collapsed eagle + goodnotes into a
    // SINGLE document (this fresh db holds nothing else), carrying the shared hash.
    const docs = handle.db.select().from(s.documents).all()
    expect(docs).toHaveLength(1)
    expect(docs[0]!.contentSha256).toBe(sha)
    // …reached by two instances, one per source.
    const instances = handle.db
      .select({ key: s.sources.key })
      .from(s.documentInstances)
      .innerJoin(s.sources, eq(s.documentInstances.sourceId, s.sources.id))
      .where(eq(s.documentInstances.documentId, docs[0]!.id))
      .all()
      .map((r) => r.key)
      .sort()
    expect(instances).toEqual(['eagle', 'goodnotes'])
  })
})

describe('goodnotes checkAvailable + scan degrade', () => {
  it('true for an existing backup dir', async () => {
    const res = await createGoodnotesConnector({ backupPath }).checkAvailable()
    expect(res.available).toBe(true)
  })

  it('false + launch hint when the backup path is missing/unset', async () => {
    const missing = await createGoodnotesConnector({ backupPath: join(dir, 'nope') }).checkAvailable()
    expect(missing.available).toBe(false)
    expect(missing.launchHint).toContain('backupPath')

    const unset = await createGoodnotesConnector({ backupPath: null }).checkAvailable()
    expect(unset.available).toBe(false)
  })

  it('scan throws (degrade signal) when the backup path is missing', async () => {
    await expect(createGoodnotesConnector({ backupPath: join(dir, 'nope') }).scan(ctx(null))).rejects.toThrow(
      /backup path missing/,
    )
  })
})
