import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, type DbHandle } from '../../db'
import { createUpsertApi, type UpsertApi } from '../../index/upsert'
import { createIndexQueries, type IndexQueries } from '../../index/queries'
import { syncConnector } from '../../index/sync'
import { createZoteroConnector } from './index'

/**
 * LIVE canary — env-gated (ASTROLABE_LIVE=1): a real end-to-end sync of THIS
 * machine's Zotero (personal + every group) into a throwaway index. Skipped by
 * default so hermetic gates stay hermetic; run explicitly before Gate S and
 * whenever the local-API contract is in doubt.
 */
const LIVE = process.env['ASTROLABE_LIVE'] === '1'

let dir: string
let handle: DbHandle
let upsert: UpsertApi
let queries: IndexQueries

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'astrolabe-live-'))
  handle = openDb(join(dir, 'index.db'))
  upsert = createUpsertApi(handle.db)
  queries = createIndexQueries(handle.db)
})
afterAll(() => {
  handle?.close()
  if (dir) rmSync(dir, { recursive: true, force: true })
})

describe.runIf(LIVE)('LIVE zotero sync — personal + groups through the whole spine', () => {
  it(
    'full first sync lands every library; incremental re-sync is a cheap no-op',
    { timeout: 600_000 },
    async () => {
      const connector = createZoteroConnector()
      const first = await syncConnector(handle.db, upsert, connector)
      expect(first.status).toBe('ok')
      expect(first.libraries.length).toBeGreaterThanOrEqual(2) // personal + ≥1 group

      const personal = first.libraries.find((l) => l.stableKey === 'personal')
      const groups = first.libraries.filter((l) => l.stableKey.startsWith('group:'))
      expect(personal?.documentsUpserted).toBeGreaterThan(0)
      expect(groups.length).toBeGreaterThanOrEqual(1)
      expect(groups[0]?.documentsUpserted).toBeGreaterThan(0)

      const snap = queries.librariesSnapshot()
      expect(snap.connectors).toEqual([{ key: 'zotero', status: 'ok' }])
      for (const lib of snap.libraries) {
        expect(lib.availability).toBe('live')
        expect(lib.documentCount).toBeGreaterThan(0)
      }

      const stats = queries.indexStats()
      expect(stats.documents).toBeGreaterThan(0)

      // Incremental: same version → every library unchanged, nothing upserted.
      const second = await syncConnector(handle.db, upsert, connector)
      expect(second.status).toBe('ok')
      for (const lib of second.libraries) {
        expect(lib.unchanged).toBe(true)
        expect(lib.documentsUpserted).toBe(0)
        expect(lib.removed).toBe(0)
      }

      console.log(
        JSON.stringify(
          {
            libraries: first.libraries.map((l) => ({
              key: l.stableKey,
              name: l.displayName,
              docs: l.documentsUpserted,
            })),
            stats,
          },
          null,
          2,
        ),
      )
    },
  )
})
