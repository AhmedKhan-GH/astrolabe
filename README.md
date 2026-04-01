# Astrolabe - Electron + React + Vite + Tailwind + SQLite + Drizzle + TypeDoc + Pino

A modern desktop application built with Electron, React, Vite, Tailwind CSS, SQLite with Drizzle ORM, TypeDoc for documentation, and Pino for logging.

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

## Current Implementation

### File System & Database Architecture

**Multi-Database Support**
Astrolabe allows users to create and manage multiple SQLite databases. Each database is a separate `.db` file that can be selected via the database dropdown in the UI. Users can switch between databases seamlessly, with each database maintaining its own independent schema and data.

```
┌─────────────────────────────────────┐
│   Database Dropdown                 │
├─────────────────────────────────────┤
│  📊 project-alpha.db     [selected] │
│  📊 project-beta.db                 │
│  📊 research-notes.db               │
│  ➕ Create New Database...          │
└─────────────────────────────────────┘
      ↓ Each database maintains
      ↓ independent data & schema
```

**File Management Model**
The application distinguishes between two types of file relationships:
- **Imported Files**: Files that are copied into the database and stored as binary data. These files are fully self-contained within the database and remain accessible even if the original file is moved or deleted.
- **Referenced Files**: Files that maintain a file path reference to external files on the filesystem. These are not stored in the database; only the path is saved, allowing for smaller database sizes but requiring the original file to remain in its location.

```
IMPORTED FILE                      REFERENCED FILE
┌──────────────────┐              ┌──────────────────┐
│   document.pdf   │              │   video.mp4      │
└────────┬─────────┘              └────────┬─────────┘
         │                                 │
         ↓ Binary data copied              ↓ Path stored only
┌─────────────────────────┐       ┌──────────────────────────┐
│  SQLite Database        │       │  SQLite Database         │
│  ┌──────────────────┐   │       │  ┌───────────────────┐   │
│  │ Files Table      │   │       │  │ Files Table       │   │
│  ├──────────────────┤   │       │  ├───────────────────┤   │
│  │ id: 1            │   │       │  │ id: 2             │   │
│  │ name: document   │   │       │  │ name: video       │   │
│  │ data: [BLOB]     │   │       │  │ data: NULL        │   │
│  │ path: NULL       │   │       │  │ path: /Users/...  │   │
│  └──────────────────┘   │       │  └───────────────────┘   │
└─────────────────────────┘       └──────────────────────────┘
 ✓ Portable & self-contained        ✓ Smaller DB size
 ✓ Works if original deleted         ⚠ Requires original file
```

**Multi-Folder Organization**
Files can be organized into multiple nested folders within each database. The folder structure supports:
- Hierarchical organization with parent-child relationships
- Drag-and-drop folder management
- Files can exist in multiple folders simultaneously through junction tables
- Each database maintains its own independent folder hierarchy

```
Folder Hierarchy                    File can exist in multiple folders
┌─────────────────────────┐        ┌──────────────────────────────────┐
│ 📁 Documents            │        │  photo.jpg                       │
│   ├─ 📁 Work            │        │    ├─ appears in "Vacation"      │
│   │   ├─ 📄 report.pdf  │        │    ├─ appears in "Family"        │
│   │   └─ 📄 notes.txt   │        │    └─ appears in "Favorites"     │
│   └─ 📁 Personal        │        │                                  │
│       ├─ 📁 Vacation    │        │  Junction Table Schema:          │
│       │   └─ 📄 photo   │◄───────┤  ┌────────┬──────────┐           │
│       └─ 📁 Family      │        │  │file_id │folder_id │           │
│           └─ 📄 photo   │◄───────┤  ├────────┼──────────┤           │
│ 📁 Projects             │        │  │   42   │    12    │ Vacation  │
│   └─ 📁 Favorites       │        │  │   42   │    15    │ Family    │
│       └─ 📄 photo       │◄───────┤  │   42   │    18    │ Favorites │
└─────────────────────────┘        │  └────────┴──────────┘           │
                                   └──────────────────────────────────┘
```

**Selective Views**
The UI provides selective views to filter and display content:
- View files by specific folders or show all files
- Filter imported vs referenced files
- Search and filter capabilities across the database
- Folder-based navigation with expandable/collapsible tree structures

```
View Options
┌───────────────────────────────────────────────────────────┐
│  Filter: [All Files ▼] [All Types ▼] [Search...        ] │
├───────────────────────────────────────────────────────────┤
│  📁 All Files (125)                                       │
│  📁 Documents (45)                                        │
│    ├─ 📄 report.pdf        [imported]                    │
│    └─ 📄 notes.txt         [imported]                    │
│  📁 Media (80)                                            │
│    ├─ 📄 video.mp4         [referenced] → /Users/...     │
│    └─ 📄 photo.jpg         [imported]                    │
│                                                           │
│  Filter Options:                                          │
│  ☑ Show Imported Files                                   │
│  ☑ Show Referenced Files                                 │
│  ☐ Show Only Unorganized Files                           │
└───────────────────────────────────────────────────────────┘
```

This architecture allows users to organize large collections of files and data across multiple databases while maintaining flexibility in how files are stored and referenced.

## Styling with Tailwind CSS

This project uses **Tailwind CSS** for styling, integrated with Vite for optimal performance.

### Configuration

Tailwind is configured in `tailwind.config.js`:
```javascript
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}
```

### Usage in React Components

Use Tailwind utility classes directly in your JSX:
``tsx
function MyComponent() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-100">
      <div className="p-6 bg-white rounded-lg shadow-lg">
        <h1 className="text-2xl font-bold text-gray-800">Hello World</h1>
        <p className="mt-2 text-gray-600">Styled with Tailwind CSS</p>
      </div>
    </div>
  );
}
```

### Importing Tailwind

Tailwind directives are imported in your main CSS file:
```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

### Custom Styles

For custom CSS beyond Tailwind utilities, you can:
1. Extend the theme in `tailwind.config.js`
2. Use `@layer` directives for custom components
3. Add regular CSS in your component-specific stylesheets

```css
@layer components {
  .btn-primary {
    @apply px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600;
  }
}
```

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

## Documentation

This project uses **TypeDoc** to generate live documentation from your code comments.

### Generating Documentation

```bash
# Generate documentation once
npm run docs

# Watch mode - auto-regenerate on file changes
npm run docs:watch
```

Documentation will be generated in the `docs/` folder. Open `docs/index.html` in your browser to view it.

### Writing Documentation

Add TSDoc/JSDoc comments above your functions, classes, and types:

```typescript
/**
 * Creates a new folder in the database.
 *
 * @param db - The database instance
 * @param name - The folder name
 * @param parentId - Optional parent folder ID for nested folders
 * @returns Promise resolving to the created folder's ID
 *
 * @example
 * const folderId = await createFolder(db, 'My Documents', parentFolderId);
 */
export async function createFolder(db: Database, name: string, parentId?: string) {
  // Implementation...
}
```

TypeDoc automatically extracts these comments and generates HTML documentation linked to your source code. You maintain documentation in one place—your code—and it stays synced automatically.

## Logging with Pino

This project uses **Pino** for fast, structured logging throughout the application.

### Using the Logger

Import and use the logger in your code:

```typescript
import { logger } from './path/to/logger';

// Different log levels
logger.info('Application started');
logger.debug('Debug information', { userId: 123 });
logger.warn('Warning message');
logger.error('Error occurred', { error: err });

// Structured logging with context
logger.info({
  action: 'database-query',
  table: 'records',
  duration: 45
}, 'Query completed');
```

### Log Levels

Pino supports multiple log levels (in order of severity):
- `trace` - Very detailed debugging
- `debug` - Debugging information
- `info` - General informational messages
- `warn` - Warning messages
- `error` - Error messages
- `fatal` - Fatal errors

### Benefits

- **Fast**: JSON logging with minimal overhead
- **Structured**: Easy to parse and analyze logs
- **Context-aware**: Add metadata to every log entry
- **Production-ready**: Optimized for performance
