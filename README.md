# Astrolabe - Electron + React + Vite + SQLite + Drizzle

A modern desktop application built with Electron, React, Vite, and SQLite with Drizzle ORM.

## Prerequisites

- Node.js 18+
- npm

## Installation

```bash
npm install
```

This will automatically:
- Install all dependencies
- Rebuild native modules (better-sqlite3) for Electron
- Set up the development environment

## Development

**First time setup:**
```bash
npm run dev
```

This will:
- Generate database migrations
- Build the Electron main process
- Start Vite dev server
- Launch the Electron app

**Subsequent runs:**
```bash
npm run start
```

This skips the migration generation and build cleanup for faster startup.


## Type-Safe Database with Drizzle ORM

This project uses **automatic type inference** from Drizzle's `$inferSelect` and `$inferInsert` to keep your database types in sync everywhere. No manual type definitions needed!

### How It Works

1. **Define your schema** in `src/db/schema.ts`:
```typescript
export const records = sqliteTable('records', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  title: text('title').notNull().default('Untitled'),
  description: text('description'),
});

// Automatically infer types from the schema
export type Record = typeof records.$inferSelect;      // What you GET from DB
export type NewRecord = typeof records.$inferInsert;   // What you PUT into DB
```

2. **Use the inferred types** in `electron/preload.ts`:
```typescript
import * as schema from '../src/db/schema';

function generateTableAPIs() {
  return {
    records: createTableClient<schema.Record, schema.NewRecord>('records'),
    // Add new tables here with their inferred types:
    // tableName: createTableClient<schema.TableName, schema.NewTableName>('tableName'),
  };
}
```

3. **Types automatically flow everywhere** - React components, IPC handlers, and database queries all use the same inferred types!

### Adding a New Table

1. Add the table definition to `src/db/schema.ts`
2. Export the inferred types: `export type TableName = typeof tableName.$inferSelect;`
3. Add one line to `generateTableAPIs()` in `electron/preload.ts`
4. Done! Full type safety across your entire app.

### Custom Queries

For complex queries beyond basic CRUD (joins, aggregations, custom filters), add custom queries with full type safety.

**Step 1:** Add the query handler in `electron/ipc.ts`:
```typescript
ipcMain.handle('db:custom', async (_event, { query, payload }) => {
  const db = getDatabase();

  switch (query) {
    case 'searchRecordsByTitle': {
      const searchTerm = payload as string;
      return db.select()
        .from(schema.records)
        .where(like(schema.records.title, `%${searchTerm}%`));
    }

    case 'getUserWithRecords': {
      const userId = payload as number;
      return db.select()
        .from(schema.users)
        .leftJoin(schema.records, eq(schema.records.userId, schema.users.id))
        .where(eq(schema.users.id, userId));
    }

    default:
      throw new Error(`Custom query "${query}" not found`);
  }
});
```

**Step 2:** Expose the typed query in `electron/preload.ts`:
```typescript
const api = {
  ...generateTableAPIs(),

  // Add custom queries with explicit return types using inferred schema types
  searchRecordsByTitle: (searchTerm: string): Promise<schema.Record[]> =>
    ipcRenderer.invoke('db:custom', { query: 'searchRecordsByTitle', payload: searchTerm }),

  getUserWithRecords: (userId: number): Promise<schema.User & { records: schema.Record[] }> =>
    ipcRenderer.invoke('db:custom', { query: 'getUserWithRecords', payload: userId }),
};
```

**Step 3:** Use it in React with full type safety:
```typescript
const results = await window.electronAPI.searchRecordsByTitle('test');
// results is typed as Record[] automatically!
```

The key is using the inferred types (`schema.Record`, `schema.User`) from `$inferSelect` as return types, ensuring type safety from database to UI.
