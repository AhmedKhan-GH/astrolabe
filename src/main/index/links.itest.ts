import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, type DbHandle } from '../db'
import { createUpsertApi, type UpsertApi } from './upsert'
import { resolveLinks, documentLinks } from './links'
import * as s from '../db/schema'

/**
 * Tier A integration: the wiki-link substrate (M2) — upsert passthrough
 * (wholesale replace per instance), resolution order (exact relpath → unique
 * basename → NULL on ambiguity), and the outlink/backlink read shapes.
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
beforeEach(() => upsert.wipeDerived())

const vault = () => upsert.ensureLibrary('obsidian', '/vault', 'Vault')

const note = (libraryId: number, relpath: string, links?: string[], title?: string) =>
  upsert.upsertDocument({
    libraryId,
    externalKey: relpath,
    uri: `obsidian://open?path=${relpath}`,
    title: title ?? relpath.replace(/\.md$/, ''),
    kind: 'note',
    modifiedAt: 1,
    links,
  })

describe('upsert links passthrough', () => {
  it('stores raw targets unresolved; absent field leaves rows untouched; present replaces wholesale', () => {
    const v = vault()
    const a = note(v.id, 'A.md', ['B', 'B', 'C']) // dupes guarded
    expect(handle.db.select().from(s.links).all()).toHaveLength(2)

    note(v.id, 'A.md') // links undefined → untouched
    expect(handle.db.select().from(s.links).all()).toHaveLength(2)

    note(v.id, 'A.md', ['D']) // present → wholesale replace
    const rows = handle.db.select().from(s.links).all()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.targetName).toBe('D')
    expect(rows[0]?.targetDocumentId).toBeNull()
    void a
  })
})

describe('resolveLinks — Obsidian resolution order', () => {
  it('exact relpath beats basename; unique basename resolves; ambiguity → NULL', () => {
    const v = vault()
    note(v.id, 'refs/B.md', undefined, 'B nested')
    const bRoot = note(v.id, 'B.md', undefined, 'B root')
    const uniq = note(v.id, 'topics/Unique.md', undefined, 'Unique')
    note(v.id, 'x/Dupe.md')
    note(v.id, 'y/Dupe.md')
    const src = note(v.id, 'Source.md', ['B', 'topics/Unique', 'Unique', 'Dupe', 'Missing'])

    resolveLinks(handle.db)

    const { outlinks } = documentLinks(handle.db, src.documentId)
    const byName = new Map(outlinks.map((o) => [o.targetName, o]))
    expect(byName.get('B')?.documentId).toBe(bRoot.documentId) // exact relpath B.md
    expect(byName.get('topics/Unique')?.documentId).toBe(uniq.documentId) // exact nested
    expect(byName.get('Unique')?.documentId).toBe(uniq.documentId) // unique basename
    expect(byName.get('Dupe')?.documentId).toBeNull() // ambiguous
    expect(byName.get('Missing')?.documentId).toBeNull() // no match
  })

  it('re-resolution updates when targets appear later; backlinks dedupe by source document', () => {
    const v = vault()
    // Two aliases that BOTH resolve to T.md: 'T' (exact relpath) and 'sub/T'
    // (no such relpath → unique basename fallback). Heading/alias stripping
    // (#, |) is the connector parser's job, not the substrate's.
    const src = note(v.id, 'S.md', ['T', 'sub/T'])
    resolveLinks(handle.db)
    expect(documentLinks(handle.db, src.documentId).outlinks.every((o) => o.documentId === null)).toBe(true)

    const target = note(v.id, 'T.md', undefined, 'Target')
    resolveLinks(handle.db)

    const back = documentLinks(handle.db, target.documentId).backlinks
    expect(back).toHaveLength(1) // two aliases in one note = one backlink
    expect(back[0]?.documentId).toBe(src.documentId)
  })
})
