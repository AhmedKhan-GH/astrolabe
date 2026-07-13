import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, type DbHandle } from '../db'
import { createUpsertApi, type UpsertApi } from '../index/upsert'
import { createReadingStateApi, type ReadingStateApi } from './reading-state'

/**
 * Tier A integration for the reading-state store (docs/2026-07-13-r2-reader-reading-state-spec
 * §Testing): the on-disk artifact + the documentId→hash resolution are the contract, so this
 * exercises real fs against a tmp dir AND real SQLite + migrations — write→read round-trip, merge
 * across two record calls, corrupt file → treated absent, unknown documentId → null, a hashless
 * document → null, and the finish set/clear cycle.
 */
let dir: string
let readingDir: string
let handle: DbHandle
let upsert: UpsertApi
let api: ReadingStateApi

// Seeded once: a hashed pdf (has reading state) and a hashless note (never does).
let pdfId: number
let noteId: number

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'astrolabe-reading-'))
  handle = openDb(join(dir, 'index.db'))
  upsert = createUpsertApi(handle.db)
})
afterAll(() => {
  handle.close()
  rmSync(dir, { recursive: true, force: true })
})

beforeEach(() => {
  upsert.wipeDerived()
  pdfId = upsert.upsertDocument({
    sourceKey: 'zotero',
    externalKey: 'Z1',
    uri: 'zotero://Z1',
    title: 'A Paper',
    kind: 'pdf',
    contentSha256: 'sha-pdf-1',
    modifiedAt: 100,
  }).documentId
  noteId = upsert.upsertDocument({
    sourceKey: 'obsidian',
    externalKey: 'note.md',
    uri: 'obsidian://note',
    title: 'A Note',
    kind: 'note',
    modifiedAt: 200,
  }).documentId
  // Fresh reading dir per test so stale files never leak across cases.
  readingDir = mkdtempSync(join(dir, 'reading-'))
  api = createReadingStateApi(readingDir, handle.db)
})

const at = Date.parse('2026-07-13T11:00:00.000Z')

describe('createReadingStateApi', () => {
  it('get returns null before anything is recorded', () => {
    expect(api.get({ documentId: pdfId })).toBeNull()
  })

  it('record → get round-trips the reading state keyed by content hash', () => {
    const recorded = api.record({ documentId: pdfId, events: [{ pageIndex: 2, dwellMs: 1200, at }] })
    expect(recorded).toMatchObject({
      contentSha256: 'sha-pdf-1',
      finished: false,
      finishedAt: null,
      pages: { '2': { dwellMs: 1200, visits: 1 } },
    })
    // The wire shape carries no schemaVersion (on-disk only).
    expect(recorded).not.toHaveProperty('schemaVersion')
    // The file lands under <hash>.json, and a fresh api instance reads it back identically.
    expect(existsSync(join(readingDir, 'sha-pdf-1.json'))).toBe(true)
    expect(createReadingStateApi(readingDir, handle.db).get({ documentId: pdfId })).toEqual(recorded)
  })

  it('merges across two record calls (dwell accumulates, visits increment)', () => {
    api.record({ documentId: pdfId, events: [{ pageIndex: 0, dwellMs: 1000, at }] })
    const merged = api.record({ documentId: pdfId, events: [{ pageIndex: 0, dwellMs: 2000, at: at + 5000 }] })
    expect(merged?.pages['0']).toMatchObject({ dwellMs: 3000, visits: 2 })
  })

  it('treats a corrupt file as absent (get → null, no throw)', () => {
    writeFileSync(join(readingDir, 'sha-pdf-1.json'), '{ not json')
    expect(api.get({ documentId: pdfId })).toBeNull()
  })

  it('treats a schema-violating file as absent', () => {
    writeFileSync(join(readingDir, 'sha-pdf-1.json'), JSON.stringify({ contentSha256: 'sha-pdf-1' }))
    expect(api.get({ documentId: pdfId })).toBeNull()
  })

  it('returns null for an unknown documentId (get/record/finish, no write)', () => {
    const ghost = 999_999
    expect(api.get({ documentId: ghost })).toBeNull()
    expect(api.record({ documentId: ghost, events: [{ pageIndex: 0, dwellMs: 10, at }] })).toBeNull()
    expect(api.finish({ documentId: ghost, finished: true })).toBeNull()
  })

  it('returns null for a document with no content hash (never writes a file)', () => {
    expect(api.get({ documentId: noteId })).toBeNull()
    expect(api.record({ documentId: noteId, events: [{ pageIndex: 0, dwellMs: 10, at }] })).toBeNull()
    expect(api.finish({ documentId: noteId, finished: true })).toBeNull()
  })

  it('finish sets finished + finishedAt, and a later finish(false) clears finishedAt', () => {
    const done = api.finish({ documentId: pdfId, finished: true })
    expect(done?.finished).toBe(true)
    expect(done?.finishedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)

    const undone = api.finish({ documentId: pdfId, finished: false })
    expect(undone?.finished).toBe(false)
    expect(undone?.finishedAt).toBeNull()
  })

  it('finish preserves already-recorded page exposure', () => {
    api.record({ documentId: pdfId, events: [{ pageIndex: 1, dwellMs: 500, at }] })
    const done = api.finish({ documentId: pdfId, finished: true })
    expect(done?.pages['1']).toMatchObject({ dwellMs: 500, visits: 1 })
    expect(done?.finished).toBe(true)
  })
})
