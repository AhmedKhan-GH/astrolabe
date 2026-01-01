import { ipcMain } from 'electron';
import { getDatabase } from './database';
import * as schema from '../src/db/schema';
import { desc } from 'drizzle-orm';

export function setupIpcHandlers() {
  // Records
  ipcMain.handle('db:records:getAll', async () => {
    const db = getDatabase();
    return await db.select().from(schema.records).orderBy(desc(schema.records.timestamp));
  });

  ipcMain.handle('db:records:create', async () => {
    const db = getDatabase();
    const result = await db.insert(schema.records).values({}).returning();
    return result[0];
  });

  console.log('IPC handlers set up successfully');
}
