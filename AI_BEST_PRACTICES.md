# AI Agent Best Practices for Astrolabe

This document outlines coding standards and best practices for AI agents working on the Astrolabe codebase.

## TypeScript Standards

### Type Safety

- **NO implicit `any` types**: All variables, parameters, and return types must be explicitly typed
  ```typescript
  // ❌ Bad
  function process(data) { ... }

  // ✅ Good
  function process(data: FileData): ProcessResult { ... }
  ```

- **Use `strict` mode**: The project has `strict: true` in `tsconfig.app.json` - maintain this
- **Prefer `type` over `interface`** for object shapes unless you need extension/merging
- **Use branded types** for IDs and special strings when appropriate

### Import/Export Standards

- **ESM only - NO `require()`**: This project uses ES modules exclusively
  ```typescript
  // ❌ Bad
  const fs = require('fs');
  const { something } = require('./module');

  // ✅ Good
  import fs from 'fs';
  import { something } from './module';
  ```

- **Use explicit file extensions** in imports when required by module resolution
- **Use `import type`** for type-only imports
  ```typescript
  import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
  import type { IFileService } from './IFileService';
  ```

- **Named exports preferred** over default exports for better refactoring

## Architecture Patterns

### Service Layer

- **Use ServiceFactory**: Never instantiate services directly
  ```typescript
  // ❌ Bad
  const fileService = new LocalFileService(db, dataDir);

  // ✅ Good
  const fileService = ServiceFactory.getFileService(config);
  ```

- **Services are singletons**: ServiceFactory manages instances - don't create duplicates
- **Always call `ServiceFactory.reset()`** when reinitializing the database

### Database Management

- **Database lifecycle**:
  1. Close existing connections before reopening
  2. Reset ServiceFactory when switching databases
  3. Use `getDatabase()` to access the initialized instance

  ```typescript
  // Example from database.ts:70-73
  export function reinitDatabase() {
    console.log('Reinitializing database...');
    ServiceFactory.reset(); // Critical: reset before reinit
    return initDatabase();
  }
  ```

- **Never access `db` directly**: Always use `getDatabase()` getter

### Error Handling

- **Always include context** in error messages
  ```typescript
  // ❌ Bad
  throw new Error('Failed');

  // ✅ Good
  throw new Error('Database is required for local folder service');
  ```

- **Log errors with context** before throwing when appropriate
  ```typescript
  console.error('Failed to initialize database:', error);
  throw error;
  ```

## Code Organization

### File Structure

- **Electron main process**: `electron/` directory
- **Renderer process (React)**: `src/` directory
- **Database schemas**: `src/db/schema.ts`
- **Database operations**: `src/db/operations/`
- **Services**: `src/services/`
- **IPC handlers**: `electron/ipc/`

### Naming Conventions

- **Interfaces**: Prefix with `I` (e.g., `IFileService`, `IFolderService`)
- **Implementation classes**: Descriptive names (e.g., `LocalFileService`, `RemoteFileService`)
- **Factory classes**: Suffix with `Factory` (e.g., `ServiceFactory`)
- **Type definitions**: PascalCase (e.g., `ServiceConfig`)

### Documentation

- **JSDoc for public APIs**: Include descriptions and `@param`/`@returns` tags
  ```typescript
  /**
   * Get or create a file service based on the provided configuration
   * Returns cached instance if available
   * @param config - Service configuration
   * @returns IFileService instance (local or remote)
   */
  static getFileService(config: ServiceConfig): IFileService { ... }
  ```

- **Inline comments** for complex logic or important state management
- **Comment WHY, not WHAT**: Code should be self-documenting for what it does

## Testing

- **Test framework**: Vitest with React Testing Library
- **Run tests**: `npm test` or `npm run test:ui`
- **Coverage**: `npm run test:coverage`
- **Write tests for**:
  - Service implementations
  - Database operations
  - Complex business logic
  - Critical paths

## Build & Development

### Scripts

- **Development**: `npm run dev` - installs, generates DB, builds electron, runs app
- **Build**: `npm run build` - full production build
- **Database**: `npm run db:generate` - generate migrations
- **Linting**: `npm run lint` - run ESLint

### Important Build Notes

- **Electron rebuild**: Native modules (better-sqlite3) require rebuild after install
- **TypeScript configs**: Three separate configs (app, node, electron)
- **Migrations included**: `drizzle/` folder packaged in production builds

## Common Pitfalls to Avoid

### 1. Database Connection Leaks
❌ Creating new connections without closing old ones
✅ Always close existing connections in `reinitDatabase()`

### 2. Service Instance Duplication
❌ Instantiating services with `new` keyword
✅ Use `ServiceFactory.getFileService()` / `getFolderService()`

### 3. Missing Type Annotations
❌ Relying on type inference for function parameters
✅ Explicitly type all function signatures

### 4. CommonJS Syntax
❌ Using `require()` or `module.exports`
✅ Use `import` and `export` statements

### 5. Forgetting ServiceFactory Reset
❌ Reinitializing database without resetting services
✅ Call `ServiceFactory.reset()` before `initDatabase()`

### 6. Unsafe Type Assertions
❌ Using `as any` or `as unknown` without justification
✅ Use proper type guards or refactor types

### 7. Missing Error Context
❌ `throw new Error('Error')`
✅ `throw new Error('Failed to initialize database: missing config.db parameter')`

## Code Review Checklist

Before submitting changes, verify:

- [ ] No `any` types (check with search)
- [ ] No `require()` statements (check with search)
- [ ] All imports use ESM syntax
- [ ] ServiceFactory used for service instantiation
- [ ] ServiceFactory.reset() called before database reinit
- [ ] Error messages include context
- [ ] Public methods have JSDoc comments
- [ ] Types are explicitly defined
- [ ] No unused imports or variables (enforced by tsconfig)
- [ ] Tests pass (`npm run test:run`)
- [ ] Linter passes (`npm run lint`)

## Project-Specific Patterns

### Configuration Management
- Settings stored via `electron-store`
- Database path managed in `electron/settings.ts`
- Service config created via `ServiceFactory.createConfigFromEnv()`

### IPC Communication
- Main process handlers in `electron/ipc/`
- Preload script exposes typed API
- Type definitions in `src/types/electron.d.ts`

### State Management
- React state for UI
- Database as source of truth
- Services handle data operations

---

**When in doubt**: Look at existing code patterns in the codebase and follow them consistently.
