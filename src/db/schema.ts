import { sqliteTable, integer, text } from 'drizzle-orm/sqlite-core';

export const files = sqliteTable('files', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  filename: text('filename').notNull(),
  path: text('path').notNull(),
  filetype: text('filetype'),
  addedAt: integer('added_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});

export type File = typeof files.$inferSelect;
export type NewFile = typeof files.$inferInsert;
