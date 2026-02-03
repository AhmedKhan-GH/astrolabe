import { sqliteTable, integer, text } from 'drizzle-orm/sqlite-core';

export const folders = sqliteTable('folders', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  parentId: integer('parent_id').notNull().default(0),
  isExpanded: integer('is_expanded', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});

export const files = sqliteTable('files', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  filename: text('filename').notNull(),
  path: text('path').notNull(),
  filetype: text('filetype'),
  folderIds: text('folder_ids'), // JSON array: [1, 2, 3]
  fileStorageType: text('file_storage_type').notNull().default('import'), // 'import' or 'reference'
  addedAt: integer('added_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});

export type Folder = typeof folders.$inferSelect;
export type NewFolder = typeof folders.$inferInsert;
export type File = typeof files.$inferSelect;
export type NewFile = typeof files.$inferInsert;
