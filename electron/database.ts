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

    // Create tables if they don't exist (for development)
    // In production, you should use proper migrations
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        created_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        content TEXT,
        user_id INTEGER,
        created_at INTEGER,
        updated_at INTEGER,
        FOREIGN KEY (user_id) REFERENCES users(id)
      );
    `);

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
