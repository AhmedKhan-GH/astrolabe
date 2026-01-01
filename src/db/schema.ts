import { sqliteTable, integer, text } from 'drizzle-orm/sqlite-core';

// ============================================
// TABLES
// ============================================

export const records = sqliteTable('records', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  timestamp: integer('timestamp', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  // DEMO: Add new fields here and they'll automatically be type-safe everywhere
  title: text('title').notNull().default('Untitled'),
  description: text('description'),
});

// Example: Add more tables and they work the same way
export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});

// ============================================
// INFERRED TYPES - Works for ANY table!
// ============================================

// Records table types
export type Record = typeof records.$inferSelect;      // What you GET from DB
export type NewRecord = typeof records.$inferInsert;   // What you PUT into DB

// Users table types (same pattern)
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

// UNIVERSAL PATTERN: For any new table, just do:
// export type TableName = typeof tableName.$inferSelect;
// export type NewTableName = typeof tableName.$inferInsert;
