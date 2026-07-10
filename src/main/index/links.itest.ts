import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { asc, eq } from 'drizzle-orm'
import { openDb, type DbHandle } from '../db'
import * as s from '../db/schema'
import { createUpsertApi, type UpsertApi } from './upsert'
import { resolveLinks, documentLinks } from './links'

/**
 * Tier A integration for the wiki-link edges (docs/2026-07-10 notes wave §Links):
 * link rows persisted at upsert (replaced wholesale per instance), `resolveLinks`
 * full-recompute resolution (relpath → unique basename → NULL on ambiguity, with
 * renamed/removed targets falling back to NULL), and the `documentLinks` read shape
 * (outlinks + backlinks, each carrying the counterpart's obsidian instance id).
 */
let dir: string
let handle: DbHandle
let upsert: UpsertApi

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'astrolabe-links-'))
  handle = openDb(join(dir, 'index.db'))
  upsert = createUpsertApi(handle.db)
})
afterAll(() => {
  handle.close()
  rmSync(dir, { recursive: true, force: true })
})
beforeEach(() => {
  upsert.wipeDerived()
})

/** Upsert an obsidian note document; relPath is the externalKey (file identity). */
function note(relPath: string, links: string[], title?: string): { documentId: number; instanceId: number } {
  return upsert.upsertDocument({
    sourceKey: 'obsidian',
    externalKey: relPath,
    uri: `obsidian://open?path=${encodeURIComponent(join('/vault', relPath))}`,
    title: title ?? relPath.replace(/\.md$/, '').split('/').pop()!,
    kind: 'note',
    modifiedAt: 1_000,
    links,
  })
}

/** The instance's link rows in insertion order (ORDER BY id — the unique index would
 *  otherwise dictate row order). */
function linkRows(instanceId: number): { targetName: string; targetDocumentId: number | null }[] {
  return handle.db
    .select({ targetName: s.links.targetName, targetDocumentId: s.links.targetDocumentId })
    .from(s.links)
    .where(eq(s.links.sourceInstanceId, instanceId))
    .orderBy(asc(s.links.id))
    .all()
}

describe('upsert persists link rows', () => {
  it('one row per target, unresolved, in note order', () => {
    const { instanceId } = note('a.md', ['Beta', 'Gamma', 'Beta']) // dupe collapses
    expect(linkRows(instanceId)).toEqual([
      { targetName: 'Beta', targetDocumentId: null },
      { targetName: 'Gamma', targetDocumentId: null },
    ])
  })

  it('re-scan replaces the instance rows WHOLESALE (annotations precedent)', () => {
    const { instanceId } = note('a.md', ['Beta', 'Gamma'])
    note('a.md', ['Delta']) // the note was edited: old links must vanish, not accumulate
    expect(linkRows(instanceId)).toEqual([{ targetName: 'Delta', targetDocumentId: null }])
  })

  it('links absent (non-note source) leaves existing rows untouched', () => {
    const { instanceId } = note('a.md', ['Beta'])
    upsert.upsertDocument({
      sourceKey: 'obsidian',
      externalKey: 'a.md',
      uri: 'obsidian://open?path=%2Fvault%2Fa.md',
      title: 'a',
      kind: 'note',
      modifiedAt: 2_000,
      // no `links` key — a payload that doesn't speak links must not clear them
    })
    expect(linkRows(instanceId)).toEqual([{ targetName: 'Beta', targetDocumentId: null }])
  })
})

describe('resolveLinks (full recompute each pass)', () => {
  it('exact vault-relpath `<target>.md` match wins', () => {
    const src = note('notes/a.md', ['projects/Beta'])
    const beta = note('projects/Beta.md', [])
    resolveLinks(handle.db)
    expect(linkRows(src.instanceId)).toEqual([
      { targetName: 'projects/Beta', targetDocumentId: beta.documentId },
    ])
  })

  it('unique basename match resolves a bare [[Name]] to the one note named Name.md', () => {
    const src = note('a.md', ['Beta'])
    const beta = note('deep/nested/Beta.md', [])
    resolveLinks(handle.db)
    expect(linkRows(src.instanceId)).toEqual([{ targetName: 'Beta', targetDocumentId: beta.documentId }])
  })

  it('ambiguous basename (two notes share it) resolves to NULL', () => {
    const src = note('a.md', ['Beta'])
    note('x/Beta.md', [])
    note('y/Beta.md', [])
    resolveLinks(handle.db)
    expect(linkRows(src.instanceId)).toEqual([{ targetName: 'Beta', targetDocumentId: null }])
  })

  it('exact relpath beats an ambiguous basename', () => {
    const src = note('a.md', ['x/Beta'])
    const xBeta = note('x/Beta.md', [])
    note('y/Beta.md', [])
    resolveLinks(handle.db)
    expect(linkRows(src.instanceId)).toEqual([{ targetName: 'x/Beta', targetDocumentId: xBeta.documentId }])
  })

  it('a target synced AFTER the linking note resolves on the next re-pass', () => {
    const src = note('a.md', ['Later'])
    resolveLinks(handle.db)
    expect(linkRows(src.instanceId)).toEqual([{ targetName: 'Later', targetDocumentId: null }])

    const later = note('Later.md', []) // the target arrives in a subsequent sync
    resolveLinks(handle.db)
    expect(linkRows(src.instanceId)).toEqual([{ targetName: 'Later', targetDocumentId: later.documentId }])
  })

  it('a renamed/removed target falls back to NULL (full recompute, not incremental)', () => {
    const src = note('a.md', ['Beta'])
    const beta = note('Beta.md', [])
    resolveLinks(handle.db)
    expect(linkRows(src.instanceId)[0]?.targetDocumentId).toBe(beta.documentId)

    // The target note is deleted from the index (its instance + document go away).
    handle.db.delete(s.documents).where(eq(s.documents.id, beta.documentId)).run()
    resolveLinks(handle.db)
    expect(linkRows(src.instanceId)).toEqual([{ targetName: 'Beta', targetDocumentId: null }])
  })
})

describe('documentLinks (the index:links payload)', () => {
  it('outlinks carry {targetName, documentId, title, kind, instanceId} in note order; unresolved → nulls', () => {
    const src = note('a.md', ['Beta', 'Missing', 'Gamma'], 'Note A')
    const beta = note('Beta.md', [], 'Note Beta')
    const gamma = note('Gamma.md', [], 'Note Gamma')
    resolveLinks(handle.db)

    const { outlinks } = documentLinks(handle.db, src.documentId)
    expect(outlinks).toEqual([
      { targetName: 'Beta', documentId: beta.documentId, title: 'Note Beta', kind: 'note', instanceId: beta.instanceId },
      { targetName: 'Missing', documentId: null, title: null, kind: null, instanceId: null },
      { targetName: 'Gamma', documentId: gamma.documentId, title: 'Note Gamma', kind: 'note', instanceId: gamma.instanceId },
    ])
  })

  it('backlinks carry {documentId, title, kind, instanceId} — the SOURCE note instance', () => {
    const target = note('Target.md', [], 'The Target')
    const a = note('a.md', ['Target'], 'Alpha Note')
    const b = note('sub/b.md', ['Target'], 'Beta Note')
    resolveLinks(handle.db)

    const { backlinks } = documentLinks(handle.db, target.documentId)
    expect(backlinks).toEqual([
      { documentId: a.documentId, title: 'Alpha Note', kind: 'note', instanceId: a.instanceId },
      { documentId: b.documentId, title: 'Beta Note', kind: 'note', instanceId: b.instanceId },
    ])
  })

  it('a document with no links either way yields empty arrays', () => {
    const lone = note('lone.md', [])
    resolveLinks(handle.db)
    expect(documentLinks(handle.db, lone.documentId)).toEqual({ outlinks: [], backlinks: [] })
  })
})
