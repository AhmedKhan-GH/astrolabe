import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, type DbHandle } from '../db'
import { createUpsertApi, type UpsertApi } from '../index/upsert'
import { createPageViewsApi, type PageViewsApi } from './page-views'

/**
 * Tier A integration for the page-range Views store (docs/2026-07-13-r3-structure-views-spec §3):
 * the on-disk artifact + the documentId→hash resolution are the contract, so this exercises real
 * fs against a tmp dir AND real SQLite + migrations — save→list round-trip keyed by content hash,
 * two documents sharing one hash sharing one set of views, delete-by-slug, corrupt file → treated
 * absent (save starts fresh), unknown documentId → null, a hashless document → null.
 */
let dir: string
let pageViewsDir: string
let handle: DbHandle
let upsert: UpsertApi
let api: PageViewsApi

// Seeded per test: a hashed pdf (can hold views), a SECOND pdf sharing the same content hash (the
// Eagle+Zotero twin), and a hashless note (never holds views).
let pdfId: number
let twinId: number
let noteId: number

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'astrolabe-page-views-'))
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
  // Same bytes, different tool — resolves to the SAME content hash, hence the SAME views file.
  twinId = upsert.upsertDocument({
    sourceKey: 'eagle',
    externalKey: 'E1',
    uri: 'eagle://E1',
    title: 'A Paper (in Eagle)',
    kind: 'pdf',
    contentSha256: 'sha-pdf-1',
    modifiedAt: 150,
  }).documentId
  noteId = upsert.upsertDocument({
    sourceKey: 'obsidian',
    externalKey: 'note.md',
    uri: 'obsidian://note',
    title: 'A Note',
    kind: 'note',
    modifiedAt: 200,
  }).documentId
  // Fresh dir per test so stale files never leak across cases.
  pageViewsDir = mkdtempSync(join(dir, 'page-views-'))
  api = createPageViewsApi(pageViewsDir, handle.db)
})

describe('createPageViewsApi', () => {
  it('list returns an empty array for a known document before anything is saved', () => {
    expect(api.list({ documentId: pdfId })).toEqual([])
  })

  it('save → list round-trips the views keyed by content hash', () => {
    const saved = api.save({ documentId: pdfId, name: 'Intro', pages: [3, 1, 1, 0] })
    expect(saved).toHaveLength(1)
    expect(saved?.[0]).toMatchObject({ slug: 'intro', name: 'Intro', pages: [0, 1, 3] })
    // The file lands under <hash>.json, and a fresh api instance reads it back identically.
    expect(existsSync(join(pageViewsDir, 'sha-pdf-1.json'))).toBe(true)
    expect(createPageViewsApi(pageViewsDir, handle.db).list({ documentId: pdfId })).toEqual(saved)
  })

  it('two documents with the same content hash share one set of views', () => {
    api.save({ documentId: pdfId, name: 'Shared', pages: [0, 2] })
    // The Eagle twin (same hash, different id) sees the view saved via the Zotero id.
    expect(api.list({ documentId: twinId })?.map((v) => v.slug)).toEqual(['shared'])
  })

  it('upsert by slug replaces pages and keeps the original createdAt', () => {
    const first = api.save({ documentId: pdfId, name: 'Ch 1', pages: [0, 1] })
    const createdAt = first?.[0].createdAt
    const second = api.save({ documentId: pdfId, name: 'Ch 1', pages: [4, 2] })
    expect(second).toHaveLength(1)
    expect(second?.[0].pages).toEqual([2, 4])
    expect(second?.[0].createdAt).toBe(createdAt)
  })

  it('delete removes a view by slug and returns the remaining list', () => {
    api.save({ documentId: pdfId, name: 'Keep', pages: [0] })
    api.save({ documentId: pdfId, name: 'Drop', pages: [1] })
    const after = api.remove({ documentId: pdfId, slug: 'drop' })
    expect(after?.map((v) => v.slug)).toEqual(['keep'])
  })

  it('treats a corrupt file as absent (list → [], save starts fresh)', () => {
    writeFileSync(join(pageViewsDir, 'sha-pdf-1.json'), '{ not json')
    expect(api.list({ documentId: pdfId })).toEqual([])
    const saved = api.save({ documentId: pdfId, name: 'Fresh', pages: [0] })
    expect(saved?.map((v) => v.slug)).toEqual(['fresh'])
  })

  it('treats a schema-violating file as absent', () => {
    writeFileSync(join(pageViewsDir, 'sha-pdf-1.json'), JSON.stringify({ contentSha256: 'sha-pdf-1' }))
    expect(api.list({ documentId: pdfId })).toEqual([])
  })

  it('returns null for an unknown documentId (list/save/remove, no write)', () => {
    const ghost = 999_999
    expect(api.list({ documentId: ghost })).toBeNull()
    expect(api.save({ documentId: ghost, name: 'X', pages: [0] })).toBeNull()
    expect(api.remove({ documentId: ghost, slug: 'x' })).toBeNull()
  })

  it('returns null for a document with no content hash (never writes a file)', () => {
    expect(api.list({ documentId: noteId })).toBeNull()
    expect(api.save({ documentId: noteId, name: 'X', pages: [0] })).toBeNull()
    expect(api.remove({ documentId: noteId, slug: 'x' })).toBeNull()
  })
})
