import { describe, it, expect } from 'vitest'
import { sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { createDbDispatcher, DbDispatchError } from './dispatcher'
import type { Db } from './index'

/**
 * Unit tier: the dispatcher's rejection branches (Tier A — this is rule-enforcing
 * boundary logic). The happy paths run against a real SQLite in db.itest.ts;
 * every rejection below must fire BEFORE the db is touched, so a poisoned stub
 * proves the fail-closed ordering.
 */
const poisonedDb = new Proxy(
  {},
  {
    get() {
      throw new Error('db must not be touched on a rejected request')
    },
  },
) as Db

const noIdTable = sqliteTable('no_id', { key: text('key') })

describe('createDbDispatcher rejections', () => {
  const dispatch = createDbDispatcher(poisonedDb, { no_id: noIdTable })

  it('rejects malformed requests (zod boundary)', async () => {
    await expect(dispatch({ nonsense: true })).rejects.toMatchObject({ code: 'INVALID_REQUEST' })
    await expect(dispatch(null)).rejects.toMatchObject({ code: 'INVALID_REQUEST' })
    await expect(dispatch({ table: 'meta', op: 'dropAllTables' })).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
    })
    await expect(
      dispatch({ table: 'meta', op: 'getById', id: 'not-a-number' }),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' })
  })

  it('rejects tables outside the whitelist', async () => {
    await expect(dispatch({ table: 'sqlite_master', op: 'getAll' })).rejects.toMatchObject({
      code: 'UNKNOWN_TABLE',
    })
  })

  it('rejects whitelisted tables without the conventional id column', async () => {
    await expect(dispatch({ table: 'no_id', op: 'getAll' })).rejects.toMatchObject({
      code: 'NOT_DISPATCHABLE',
    })
  })

  it('errors are typed DbDispatchError', async () => {
    await expect(dispatch({})).rejects.toBeInstanceOf(DbDispatchError)
  })
})
