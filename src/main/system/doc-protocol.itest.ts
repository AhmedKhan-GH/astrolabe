import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, type DbHandle } from '../db'
import { createUpsertApi, type UpsertApi } from '../index/upsert'
import { resolveInstanceFile } from './doc-protocol'

/**
 * The pure resolution the astro://doc handler is built on (docs/2026-07-10 canvas spec
 * §Serving PDF bytes): map an instance id to its allowlisted on-disk path, or null when it
 * can't be served (unknown id / null filePath). The handler's own 404-on-null and streaming
 * are covered by using the app, not jsdom — this is the branching logic worth a test.
 */
let dir: string
let handle: DbHandle
let upsert: UpsertApi

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'astrolabe-doc-protocol-'))
  handle = openDb(join(dir, 'index.db'))
  upsert = createUpsertApi(handle.db)
})
afterAll(() => {
  handle.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('resolveInstanceFile', () => {
  it('returns null for an unknown instance id', () => {
    expect(resolveInstanceFile(handle.db, 99999)).toBeNull()
  })

  it('returns null when the instance carries a null filePath', () => {
    const { instanceId } = upsert.upsertDocument({
      sourceKey: 'obsidian', externalKey: 'note.md', uri: 'obsidian://note', title: 'No File',
      kind: 'note', modifiedAt: 1,
    })
    expect(resolveInstanceFile(handle.db, instanceId)).toBeNull()
  })

  it('resolves the stored filePath for a real instance', () => {
    const filePath = join(dir, 'doc.pdf')
    writeFileSync(filePath, '%PDF-1.4\n')
    const { instanceId } = upsert.upsertDocument({
      sourceKey: 'zotero', externalKey: 'Z9', uri: 'zotero://Z9', title: 'Has File',
      kind: 'pdf', filePath, contentSha256: 'hz9', modifiedAt: 1,
    })
    expect(resolveInstanceFile(handle.db, instanceId)).toBe(filePath)
  })

  it('returns null for a non-positive or non-integer id (never hits the DB)', () => {
    expect(resolveInstanceFile(handle.db, 0)).toBeNull()
    expect(resolveInstanceFile(handle.db, -1)).toBeNull()
    expect(resolveInstanceFile(handle.db, 1.5)).toBeNull()
    expect(resolveInstanceFile(handle.db, Number.NaN)).toBeNull()
  })
})
