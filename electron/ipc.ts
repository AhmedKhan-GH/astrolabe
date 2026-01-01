import { ipcMain } from 'electron';
import { getDatabase } from './database';
import * as schema from '../src/shared/db/schema';
import { eq } from 'drizzle-orm';

export function setupIpcHandlers() {
  // Users
  ipcMain.handle('db:users:getAll', async () => {
    const db = getDatabase();
    return await db.select().from(schema.users);
  });

  ipcMain.handle('db:users:create', async (_, data: { name: string; email: string }) => {
    const db = getDatabase();
    const result = await db.insert(schema.users).values(data).returning();
    return result[0];
  });

  ipcMain.handle('db:users:delete', async (_, id: number) => {
    const db = getDatabase();
    await db.delete(schema.users).where(eq(schema.users.id, id));
    return { success: true };
  });

  // Notes
  ipcMain.handle('db:notes:getAll', async () => {
    const db = getDatabase();
    return await db.select().from(schema.notes);
  });

  ipcMain.handle('db:notes:getByUser', async (_, userId: number) => {
    const db = getDatabase();
    return await db.select().from(schema.notes).where(eq(schema.notes.userId, userId));
  });

  ipcMain.handle('db:notes:create', async (_, data: { title: string; content?: string; userId?: number }) => {
    const db = getDatabase();
    const result = await db.insert(schema.notes).values(data).returning();
    return result[0];
  });

  ipcMain.handle('db:notes:update', async (_, id: number, data: { title?: string; content?: string }) => {
    const db = getDatabase();
    const result = await db.update(schema.notes)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(schema.notes.id, id))
      .returning();
    return result[0];
  });

  ipcMain.handle('db:notes:delete', async (_, id: number) => {
    const db = getDatabase();
    await db.delete(schema.notes).where(eq(schema.notes.id, id));
    return { success: true };
  });

  console.log('IPC handlers set up successfully');
}
