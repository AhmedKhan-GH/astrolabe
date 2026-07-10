import { join } from 'node:path'
// Guarded default import — see logger.ts; this module also runs outside Electron
// (vitest, tsx scripts, the step-7 MCP server).
import electron from 'electron'
import Database from 'better-sqlite3'

const app = (electron as unknown as {
  app?: { isPackaged: boolean; getAppPath(): string }
})?.app
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import * as schema from './schema'
import { moduleLogger } from '../lib/logger'

const log = moduleLogger('db')

export type Db = BetterSQLite3Database<typeof schema>

export interface DbHandle {
  db: Db
  sqlite: Database.Database
  close: () => void
}

/** Migrations live in repo /drizzle (committed — iteration-2 scar); packaged via extraResources. */
export function migrationsFolder(): string {
  // Outside Electron (tests, MCP server) resolve from cwd.
  if (app == null || typeof app.isPackaged !== 'boolean') return join(process.cwd(), 'drizzle')
  return app.isPackaged
    ? join(process.resourcesPath, 'drizzle')
    : join(app.getAppPath(), 'drizzle')
}

/**
 * Open (or create) the index DB and bring it to schema. Throws on any failure —
 * boot handles it fail-fast (doc 10 §4). WAL for concurrent readers (the MCP
 * server reads this file read-only in step 7).
 */
export function openDb(dbPath: string, migrations: string = migrationsFolder()): DbHandle {
  const sqlite = new Database(dbPath)
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  const db = drizzle(sqlite, { schema })
  migrate(db, { migrationsFolder: migrations })
  log.info({ dbPath }, 'index db open, schema current')
  return { db, sqlite, close: () => sqlite.close() }
}
