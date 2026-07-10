import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { openDb, type DbHandle } from '../db'
import * as s from '../db/schema'
import { createUpsertApi, type UpsertApi } from './upsert'
import { createSyncApi } from './sync'
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
