import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import path from 'path';
import { app } from 'electron';
import fs from 'fs';

export async function runMigrations() {
  try {
    const userDataPath = app.getPath('userData');
    const dbPath = path.join(userDataPath, 'astrolabe.db');

    // Ensure the directory exists
    const dbDir = path.dirname(dbPath);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    const sqlite = new Database(dbPath);
    sqlite.pragma('journal_mode = WAL');

    const db = drizzle(sqlite);

    // In production, migrations folder will be in the app.asar or resources
    const migrationsFolder = app.isPackaged
      ? path.join(process.resourcesPath, 'drizzle')
      : path.join(process.cwd(), 'drizzle');

    console.log('Running migrations from:', migrationsFolder);

    await migrate(db, { migrationsFolder });

    console.log('Migrations completed successfully');
    sqlite.close();
  } catch (error) {
    console.error('Migration failed:', error);
    throw error;
  }
}
