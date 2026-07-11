import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { openDb, type DbHandle } from '../db'
import * as s from '../db/schema'
import { createUpsertApi, type UpsertApi } from './upsert'
import { createSyncApi } from './sync'
import { createIndexQueries } from './queries'
import { createReconcileApi } from './reconcile'
import type { Connector, ScanResult } from '../connectors/types'

/**
 * Tier A integration: sync orchestration status writes against real SQLite.
 * The branch under test (in-app permission flow): a TCC-style EPERM from scan
 * → sources.status 'denied'; any other scan failure → 'unavailable'.
 */
let dir: string
let handle: DbHandle
let upsert: UpsertApi

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'astrolabe-sync-'))
  handle = openDb(join(dir, 'index.db'))
  upsert = createUpsertApi(handle.db)
})
afterAll(() => {
  handle.close()
  rmSync(dir, { recursive: true, force: true })
})
beforeEach(() => upsert.wipeDerived())

const fakeConnector = (over: Partial<Connector>): Connector => ({
  key: 'obsidian',
  checkAvailable: async () => ({ available: true }),
  scan: async (): Promise<ScanResult> => ({ cursor: null, documentsUpserted: 0, annotationsUpserted: 0 }),
  resolve: async (uri) => ({ uri }),
  ...over,
})

const statusOf = (key: string) =>
  handle.db.select().from(s.sources).where(eq(s.sources.key, key)).get()?.status

describe('syncOne status classification', () => {
  it('marks a source denied when scan throws EPERM (TCC-blocked vault)', async () => {
    const denied = fakeConnector({
      scan: async () => {
        throw Object.assign(new Error("EPERM: operation not permitted, scandir '/vault'"), { code: 'EPERM' })
      },
    })
    const report = await createSyncApi(handle.db, [denied], upsert).syncOne(denied)
    expect(report.ok).toBe(false)
    expect(statusOf('obsidian')).toBe('denied')
  })

  it('marks a source unavailable when scan throws a non-permission error', async () => {
    const broken = fakeConnector({
      scan: async () => {
        throw new Error('vault path missing or not found: <unset>')
      },
    })
    await createSyncApi(handle.db, [broken], upsert).syncOne(broken)
    expect(statusOf('obsidian')).toBe('unavailable')
  })

  it('recovers to ok on a subsequent clean scan', async () => {
    const denied = fakeConnector({
      scan: async () => {
        throw Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' })
      },
    })
    await createSyncApi(handle.db, [denied], upsert).syncOne(denied)
    expect(statusOf('obsidian')).toBe('denied')

    const healthy = fakeConnector({})
    await createSyncApi(handle.db, [healthy], upsert).syncOne(healthy)
    expect(statusOf('obsidian')).toBe('ok')
  })
})

/**
 * Removal reconciliation at the sync level (the post-scan sweep). A successful scan that returns
 * `allExternalKeys` drives it; an absent set or a throwing scan never sweeps (degrade contract).
 */
const searchTitles = (q: string) => createIndexQueries(handle.db).search({ q }).map((h) => h.title)

/** Seed a document reached by both a zotero and an eagle instance (the hash join), returning its id. */
function seedBothPresence(zKey: string, eKey: string, title: string): number {
  const sha = `sha-${title}`
  upsert.upsertDocument({ sourceKey: 'zotero', externalKey: zKey, uri: `z://${zKey}`, title, kind: 'pdf', contentSha256: sha, filePath: `/z/${zKey}.pdf`, modifiedAt: 1 })
  upsert.upsertDocument({ sourceKey: 'eagle', externalKey: eKey, uri: `e://${eKey}`, title, kind: 'pdf', contentSha256: sha, filePath: `/e/${eKey}.pdf`, modifiedAt: 1 })
  return handle.db.select().from(s.documents).where(eq(s.documents.contentSha256, sha)).get()!.id
}

const zoteroConn = (allExternalKeys: string[] | undefined): Connector =>
  fakeConnector({ key: 'zotero', scan: async () => ({ cursor: null, documentsUpserted: 0, annotationsUpserted: 0, allExternalKeys }) })

describe('sync removal reconciliation', () => {
  it('MOTIVATING SCENARIO: a Zotero deletion is swept → presence flips to eagle-only → the to-zotero transfer gate reopens', async () => {
    const documentId = seedBothPresence('ZK1', 'EK1', 'Promoted Paper')
    const queries = createIndexQueries(handle.db)
    // A mock write client that always succeeds; fileExists forced true (the eagle copy is "on disk").
    const zoteroWrite = { promoteDocument: async () => ({ ok: true as const }) }
    const eagleWrite = { importDocument: async () => ({ ok: true as const }) }
    const reconcile = createReconcileApi(handle.db, queries, { zoteroWrite, eagleWrite, fileExists: () => true })

    // Before the deletion: presence is `both`, so re-promoting to Zotero is (idempotently) refused.
    expect(queries.documentDetail(documentId)?.presence).toBe('both')
    expect(await reconcile.transfer({ documentId, direction: 'to-zotero' })).toEqual({ ok: false, reason: 'Already in Zotero.' })

    // The user trashes it in Zotero. Next zotero sync enumerates keys WITHOUT ZK1 → sweep.
    const conn = zoteroConn([]) // zotero source now lists nothing
    const report = await createSyncApi(handle.db, [conn], upsert).syncOne(conn)

    expect(report.documentsRemoved).toBe(0) // the document survives (eagle instance remains)
    // Presence flipped to eagle-only, and the transfer gate now PERMITS re-sending to Zotero.
    expect(queries.documentDetail(documentId)?.presence).toBe('eagle-only')
    expect(await reconcile.transfer({ documentId, direction: 'to-zotero' })).toEqual({ ok: true })
  })

  it('orphan pruning: a sole-instance document vanishes entirely, incl. its FTS row and outgoing links', async () => {
    // A zotero doc (sole instance) that is FTS-searchable, plus an obsidian note linking to it.
    upsert.upsertDocument({
      sourceKey: 'zotero', externalKey: 'SOLE', uri: 'z://SOLE', title: 'Lonely Paper', kind: 'pdf', modifiedAt: 1,
      annotations: [{ externalKey: 'a1', type: 'highlight', text: 'findmetoken', modifiedAt: 1 }],
    })
    upsert.upsertDocument({
      sourceKey: 'obsidian', externalKey: 'ref.md', uri: 'o://ref', title: 'Ref', kind: 'note', modifiedAt: 1,
      links: ['Lonely Paper'],
    })
    expect(searchTitles('findmetoken')).toContain('Lonely Paper')
    const linkCountBefore = handle.db.select().from(s.links).all().length
    expect(linkCountBefore).toBe(1)

    const conn = zoteroConn([]) // zotero lists nothing → SOLE swept → orphan → document removed
    const report = await createSyncApi(handle.db, [conn], upsert).syncOne(conn)

    expect(report.documentsRemoved).toBe(1)
    expect(searchTitles('findmetoken')).toHaveLength(0) // FTS row gone
    expect(handle.db.select().from(s.documents).where(eq(s.documents.title, 'Lonely Paper')).all()).toHaveLength(0)
    // The obsidian note's outgoing link had targetName only (unresolved), so it survives as a row,
    // but any link that had pointed AT the removed doc would be SET NULL — assert the note's own
    // source links are intact (they belong to the surviving note instance).
    expect(handle.db.select().from(s.links).all()).toHaveLength(1)
  })

  it('surviving-document FTS refresh: a swept instance leaves the doc searchable by its remaining source', async () => {
    const sha = 'shared-survivor'
    // Zotero instance carries an annotation with a distinctive token; eagle instance carries the file.
    upsert.upsertDocument({
      sourceKey: 'zotero', externalKey: 'ZS', uri: 'z://ZS', title: 'Survivor Doc', kind: 'pdf', contentSha256: sha, modifiedAt: 1,
      annotations: [{ externalKey: 'za', type: 'highlight', text: 'zoterotoken', modifiedAt: 1 }],
    })
    upsert.upsertDocument({ sourceKey: 'eagle', externalKey: 'ES', uri: 'e://ES', title: 'Survivor Doc', kind: 'pdf', contentSha256: sha, filePath: '/e/ES.pdf', modifiedAt: 1 })
    expect(searchTitles('zoterotoken')).toContain('Survivor Doc')

    const conn = zoteroConn([]) // zotero instance swept, eagle survives
    const report = await createSyncApi(handle.db, [conn], upsert).syncOne(conn)

    expect(report.documentsRemoved).toBe(0) // still has the eagle instance
    // Title still searchable (FTS refreshed); the zotero-annotation body is gone with its instance.
    expect(searchTitles('Survivor')).toContain('Survivor Doc')
    expect(searchTitles('zoterotoken')).toHaveLength(0)
  })

  it('absent allExternalKeys → NO sweep (the safe default; a connector that cannot enumerate)', async () => {
    upsert.upsertDocument({ sourceKey: 'zotero', externalKey: 'KEEPME', uri: 'z://KEEPME', title: 'Untouched', kind: 'pdf', modifiedAt: 1 })
    const conn = zoteroConn(undefined) // scan returns no key set
    const report = await createSyncApi(handle.db, [conn], upsert).syncOne(conn)

    expect(report.documentsRemoved).toBe(0)
    expect(searchTitles('Untouched')).toContain('Untouched') // nothing swept
  })

  it('empty-array allExternalKeys → sweeps everything of that source', async () => {
    upsert.upsertDocument({ sourceKey: 'zotero', externalKey: 'GONE1', uri: 'z://1', title: 'Gone One', kind: 'pdf', modifiedAt: 1 })
    upsert.upsertDocument({ sourceKey: 'zotero', externalKey: 'GONE2', uri: 'z://2', title: 'Gone Two', kind: 'pdf', modifiedAt: 1 })
    const conn = zoteroConn([])
    const report = await createSyncApi(handle.db, [conn], upsert).syncOne(conn)

    expect(report.documentsRemoved).toBe(2)
    expect(handle.db.select().from(s.documents).all()).toHaveLength(0)
  })

  it('a throwing scan sweeps nothing (degrade contract intact)', async () => {
    upsert.upsertDocument({ sourceKey: 'zotero', externalKey: 'SAFE', uri: 'z://SAFE', title: 'Safe Doc', kind: 'pdf', modifiedAt: 1 })
    const conn = fakeConnector({ key: 'zotero', scan: async () => { throw new Error('scan blew up') } })
    const report = await createSyncApi(handle.db, [conn], upsert).syncOne(conn)

    expect(report.ok).toBe(false)
    expect(report.documentsRemoved).toBeUndefined()
    expect(searchTitles('Safe')).toContain('Safe Doc') // nothing swept
  })
})
