import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from '../src/db/schema';
import { app } from 'electron';
import path from 'path';
import fs from 'fs';

let db: ReturnType<typeof drizzle> | null = null;

export function initDatabase() {
  try {
    // Ensure data directory exists
    const userDataPath = app.getPath('userData');
    const dataDir = path.join(userDataPath, 'data');

    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    const dbPath = path.join(dataDir, 'astrolabe.db');
    console.log('Database path:', dbPath);

    const sqlite = new Database(dbPath);
    sqlite.pragma('journal_mode = WAL');

    db = drizzle(sqlite, { schema });

    // Run migrations
    // In development: __dirname is dist-electron/electron, so we go up 2 levels
    // In production: migrations should be bundled at the same relative location
    const migrationsFolder = app.isPackaged
      ? path.join(process.resourcesPath, 'drizzle')
      : path.join(__dirname, '../../drizzle');
    console.log('Migrations folder:', migrationsFolder);

    if (!fs.existsSync(migrationsFolder)) {
      const isDev = !app.isPackaged;
      const errorMessage = isDev
        ? 'Migrations folder not found. Run "npm run db:generate" to create migrations from your schema.'
        : 'Migrations folder not found. This is a critical error - the app was not built correctly.';
      console.error(errorMessage);
      throw new Error(errorMessage);
    }

    migrate(db, { migrationsFolder });
    console.log('Database migrations applied successfully');

    console.log('Database initialized successfully');

    return db;
  } catch (error) {
    console.error('Failed to initialize database:', error);
    throw error;
  }
}

export function getDatabase() {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase first.');
  }
  return db;
}
