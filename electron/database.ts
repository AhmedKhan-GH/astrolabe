import Database from 'better-sqlite3';
import { drizzle, BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from '../src/db/schema';
import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import { getDataDirectory, addDatabaseToList } from './settings';

let db: BetterSQLite3Database<typeof schema> | null = null;
let sqlite: Database.Database | null = null;

export function initDatabase() {
  try {
    // Close existing connection if any
    if (sqlite) {
      console.log('Closing existing database connection');
      sqlite.close();
      sqlite = null;
      db = null;
    }

    // Get data directory (settings.ts ensures it exists)
    const dataDir = getDataDirectory();
    const dbPath = path.join(dataDir, 'astrolabe.db');
    console.log('Database path:', dbPath);

    // Add the data directory to the databases list if not already present
    addDatabaseToList(dataDir);

    sqlite = new Database(dbPath);
    // WAL mode disabled - single file database
    // sqlite.pragma('journal_mode = WAL');

    db = drizzle(sqlite, { schema });

    // Run migrations if folder exists
    const migrationsFolder = app.isPackaged
      ? path.join(process.resourcesPath, 'drizzle')
      : path.join(__dirname, '../../drizzle');

    if (fs.existsSync(migrationsFolder)) {
      migrate(db, { migrationsFolder });
      console.log('Migrations applied');
    } else {
      console.log('No migrations folder found, skipping');
    }

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

/**
 * Reinitialize database connection (useful when switching databases)
 */
export function reinitDatabase() {
  console.log('Reinitializing database...');
  return initDatabase();
}
