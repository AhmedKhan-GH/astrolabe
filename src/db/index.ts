import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';
import path from 'path';
import { app } from 'electron';
import fs from 'fs';

// Get the user data directory for storing the database
const userDataPath = app.getPath('userData');
const dbPath = path.join(userDataPath, 'astrolabe.db');

// Ensure the directory exists
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

// Create SQLite connection
const sqlite = new Database(dbPath);

// Enable WAL mode for better concurrent access
sqlite.pragma('journal_mode = WAL');

// Create Drizzle ORM instance
export const db = drizzle(sqlite, { schema });

// Export the schema for use in queries
export { schema };

// Close database connection gracefully
export function closeDatabase() {
  sqlite.close();
}
