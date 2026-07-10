import Database from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from '../main/db/schema'

/**
 * Read-only index handle for the step-7 MCP server. Deliberately NOT src/main/db's
 * openDb: that one runs migrations and opens read-write. The MCP process is a guest
 * on the live index — it opens with `readonly` + `fileMustExist` and never migrates
 * or writes. WAL (set by the owning app) makes concurrent reads safe while the app
 * runs; if the file is absent we fail fast rather than create an empty stub.
 */
export type Db = BetterSQLite3Database<typeof schema>

export interface ReadonlyDbHandle {
  db: Db
  /** Raw handle — exposed so tests can prove the read-only guarantee. */
  sqlite: Database.Database
  close: () => void
}

export function openReadonlyDb(dbPath: string): ReadonlyDbHandle {
  const sqlite = new Database(dbPath, { readonly: true, fileMustExist: true })
  const db = drizzle(sqlite, { schema })
  return { db, sqlite, close: () => sqlite.close() }
}
