import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, type DbHandle } from './index'
import { createDbDispatcher } from './dispatcher'

/**
 * Integration tier: real better-sqlite3 in a temp dir, real committed migrations
 * (INFRASTRUCTURE-SPEC Pillar 1 tier table). Runs under `pnpm test:integration`
 * (vitest inside Electron-as-node so the electron-ABI native binary loads).
 */
let dir: string
let handle: DbHandle
let dispatch: ReturnType<typeof createDbDispatcher>

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'astrolabe-itest-'))
  handle = openDb(join(dir, 'index.db'))
  dispatch = createDbDispatcher(handle.db)
})

afterAll(() => {
  handle.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('db + dispatcher round-trip (real sqlite, real migrations)', () => {
  it('migrations bring up the schema; table starts empty', async () => {
    expect(await dispatch({ table: 'meta', op: 'getAll' })).toEqual([])
  })

  it('create → getById → update → delete round-trip', async () => {
    const created = (await dispatch({
      table: 'meta',
      op: 'create',
      values: { key: 'schemaProbe', value: 'v1' },
    })) as { id: number; key: string; value: string }
    expect(created.id).toBeGreaterThan(0)
    expect(created.key).toBe('schemaProbe')

    const fetched = await dispatch({ table: 'meta', op: 'getById', id: created.id })
    expect(fetched).toEqual(created)

    const updated = (await dispatch({
      table: 'meta',
      op: 'update',
      id: created.id,
      values: { value: 'v2' },
    })) as { value: string }
    expect(updated.value).toBe('v2')

    expect(await dispatch({ table: 'meta', op: 'delete', id: created.id })).toBe(1)
    expect(await dispatch({ table: 'meta', op: 'getById', id: created.id })).toBeNull()
  })

  it('unique constraint enforced by the real schema (not app code)', async () => {
    await dispatch({ table: 'meta', op: 'create', values: { key: 'dupe', value: 'a' } })
    await expect(
      dispatch({ table: 'meta', op: 'create', values: { key: 'dupe', value: 'b' } }),
    ).rejects.toThrow(/UNIQUE/i)
  })

  it('reopening the same db is idempotent (migrations re-run safely)', () => {
    // Sequential open→close→open in an isolated dir. v1 reopened the SHARED db
    // while the beforeAll handle was still open — two live better-sqlite3
    // handles on one WAL file segfault Electron-as-node at process exit
    // (native teardown), which is also a state the app can never reach.
    const dir2 = mkdtempSync(join(tmpdir(), 'astrolabe-reopen-'))
    const first = openDb(join(dir2, 'index.db'))
    first.close()
    const again = openDb(join(dir2, 'index.db'))
    again.close()
    rmSync(dir2, { recursive: true, force: true })
  })
})
