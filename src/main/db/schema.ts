import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

/**
 * Index schema. Convention: every table carries an integer autoincrement `id`
 * primary key — the generic table-client dispatch depends on it (docs/10 §9:
 * stable ids, explicit modeling).
 *
 * Step 2 ships only `meta` — real workspace bookkeeping (schema version markers,
 * sync bookkeeping), NOT a demo table (the iteration-2 users/records scar).
 * Domain tables (documents, instances, tags, collections, annotations) land in
 * step 3 with the connector contract.
 */
export const meta = sqliteTable('meta', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  key: text('key').notNull().unique(),
  value: text('value').notNull(),
})

export type Meta = typeof meta.$inferSelect
export type NewMeta = typeof meta.$inferInsert
