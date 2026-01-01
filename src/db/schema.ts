import { sqliteTable, integer } from 'drizzle-orm/sqlite-core';

export const records = sqliteTable('records', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  timestamp: integer('timestamp', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});
