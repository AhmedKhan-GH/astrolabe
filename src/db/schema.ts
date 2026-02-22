import { sqliteTable, integer, text, primaryKey } from 'drizzle-orm/sqlite-core';
import { relations } from 'drizzle-orm';

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
  fileStorageType: text('file_storage_type').notNull().default('import'), // 'import' or 'reference'
  addedAt: integer('added_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});

// Junction table for many-to-many relationship between files and folders
export const fileFolders = sqliteTable('file_folders', {
  fileId: integer('file_id').notNull().references(() => files.id, { onDelete: 'cascade' }),
  folderId: integer('folder_id').notNull(),
  addedAt: integer('added_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
}, (table) => ({
  pk: primaryKey({ columns: [table.fileId, table.folderId] }),
}));

// Define relations
export const filesRelations = relations(files, ({ many }) => ({
  fileFolders: many(fileFolders),
}));

export const foldersRelations = relations(folders, ({ many }) => ({
  fileFolders: many(fileFolders),
}));

export const fileFoldersRelations = relations(fileFolders, ({ one }) => ({
  file: one(files, {
    fields: [fileFolders.fileId],
    references: [files.id],
  }),
  folder: one(folders, {
    fields: [fileFolders.folderId],
    references: [folders.id],
  }),
}));

export type Folder = typeof folders.$inferSelect;
export type NewFolder = typeof folders.$inferInsert;
export type File = typeof files.$inferSelect;
export type NewFile = typeof files.$inferInsert;
export type FileFolder = typeof fileFolders.$inferSelect;
export type NewFileFolder = typeof fileFolders.$inferInsert;
