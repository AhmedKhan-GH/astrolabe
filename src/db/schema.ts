import { sqliteTable, integer, text } from 'drizzle-orm/sqlite-core';

export const files = sqliteTable('files', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  filename: text('filename').notNull(),
  originalPath: text('original_path').notNull(),
  storedPath: text('stored_path').notNull(),
  size: integer('size').notNull(),
  mimeType: text('mime_type'),
  uploadedAt: integer('uploaded_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});

export type File = typeof files.$inferSelect;
export type NewFile = typeof files.$inferInsert;
