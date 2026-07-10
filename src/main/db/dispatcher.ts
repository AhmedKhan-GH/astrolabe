import { eq, getTableColumns } from 'drizzle-orm'
import type { SQLiteTable } from 'drizzle-orm/sqlite-core'
import { dbRequestSchema } from '../../shared/db-ipc'
import type { Db } from './index'
import * as schema from './schema'

/**
 * Generic CRUD dispatch for the `db:query` channel (Tier A — this branches, so it
 * is test-first; see dispatcher.test.ts / db.itest.ts). Tables are dispatchable
 * only if whitelisted here AND carrying the conventional integer `id` column.
 */
export const tableRegistry: Record<string, SQLiteTable> = {
  meta: schema.meta,
}

export class DbDispatchError extends Error {
  readonly code: 'INVALID_REQUEST' | 'UNKNOWN_TABLE' | 'NOT_DISPATCHABLE'
  constructor(message: string, code: DbDispatchError['code']) {
    super(message)
    this.code = code
  }
}

export function createDbDispatcher(db: Db, registry: Record<string, SQLiteTable> = tableRegistry) {
  return async (raw: unknown): Promise<unknown> => {
    const parsed = dbRequestSchema.safeParse(raw)
    if (!parsed.success) {
      throw new DbDispatchError(`invalid db request: ${parsed.error.message}`, 'INVALID_REQUEST')
    }
    const req = parsed.data

    const table = registry[req.table]
    if (!table) throw new DbDispatchError(`unknown table: ${req.table}`, 'UNKNOWN_TABLE')

    const idColumn = getTableColumns(table)['id']
    if (!idColumn) {
      throw new DbDispatchError(`table not dispatchable (no id column): ${req.table}`, 'NOT_DISPATCHABLE')
    }

    switch (req.op) {
      case 'getAll':
        return db.select().from(table)
      case 'getById': {
        const rows = await db.select().from(table).where(eq(idColumn, req.id)).limit(1)
        return rows[0] ?? null
      }
      case 'create': {
        const rows = await db.insert(table).values(req.values).returning()
        return rows[0]
      }
      case 'update': {
        const rows = await db.update(table).set(req.values).where(eq(idColumn, req.id)).returning()
        return rows[0] ?? null
      }
      case 'delete': {
        const rows = await db.delete(table).where(eq(idColumn, req.id)).returning()
        return rows.length
      }
    }
  }
}
