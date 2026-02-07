import Database from 'better-sqlite3';
import { drizzle, BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from '../src/db/schema';
import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import { getDataDirectory, addDatabaseToList } from './settings';
import { ServiceFactory } from '../src/services/ServiceFactory';
import { logger } from './utils/logger';

let db: BetterSQLite3Database<typeof schema> | null = null;
let sqlite: Database.Database | null = null;

export function initDatabase() {
  logger.info('Starting database initialization...');

  try {
    // Close existing connection if any
    if (sqlite) {
      logger.info('Closing existing database connection');
      sqlite.close();
      sqlite = null;
      db = null;
      logger.info('Existing connection closed');
    }

    // Get data directory (settings.ts ensures it exists)
    const dataDir = getDataDirectory();
    const dbPath = path.join(dataDir, 'astrolabe.db');
    const dbExists = fs.existsSync(dbPath);
    logger.info({
      dbPath,
      dataDir,
      exists: dbExists,
      isNew: !dbExists
    }, `${dbExists ? 'Opening existing' : 'Creating new'} database`);

    // Add the data directory to the databases list if not already present
    addDatabaseToList(dataDir);

    logger.info('Establishing SQLite connection...');
    sqlite = new Database(dbPath);
    // WAL mode disabled - single file database
    // sqlite.pragma('journal_mode = WAL');

    logger.info('Initializing Drizzle ORM...');
    db = drizzle(sqlite, { schema });

    // Run migrations if folder exists
    const migrationsFolder = app.isPackaged
      ? path.join(process.resourcesPath, 'drizzle')
      : path.join(__dirname, '../../drizzle');

    logger.info({ migrationsFolder, isPackaged: app.isPackaged }, 'Checking for migrations');

    if (fs.existsSync(migrationsFolder)) {
      logger.info('Running database migrations...');
      migrate(db, { migrationsFolder });
      logger.info('Migrations applied successfully');
    } else {
      logger.warn({ migrationsFolder }, 'No migrations folder found, skipping');
    }

    logger.info('Database initialized successfully');

    return db;
  } catch (error) {
    logger.error({ error }, 'Failed to initialize database');
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
  logger.info('Reinitializing database (switching databases)...');
  // Reset service instances before reinitializing database
  logger.info('Resetting service factory instances...');
  ServiceFactory.reset();
  logger.info('Service factory reset complete');
  return initDatabase();
}
