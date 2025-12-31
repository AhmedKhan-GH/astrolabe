import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

// Example schema - modify according to your needs
export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
});

// Add more tables as needed
// export const posts = sqliteTable('posts', {
//   id: integer('id').primaryKey({ autoIncrement: true }),
//   title: text('title').notNull(),
//   content: text('content'),
//   userId: integer('user_id').references(() => users.id),
// });
