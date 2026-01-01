import { ipcMain } from 'electron';
import { getDatabase } from './database';
import { eq } from 'drizzle-orm';
import * as schema from '../src/db/schema';

/**
 * Single generic IPC handler for ALL database operations
 * Add a table to schema.ts → it works automatically here
 */
export function setupIpcHandlers() {
  ipcMain.handle('db:query', async (_event, { table, operation, payload }) => {
    const db = getDatabase();
    const tableSchema = (schema as any)[table];

    if (!tableSchema) {
      throw new Error(`Table "${table}" not found`);
    }

    switch (operation) {
      case 'getAll':
        return await db.select().from(tableSchema);

      case 'getById':
        return await db.select().from(tableSchema).where(eq(tableSchema.id, payload));

      case 'create': {
        const created = await db.insert(tableSchema).values(payload).returning() as any[];
        return created[0];
      }

      case 'update': {
        const updated = await db.update(tableSchema).set(payload.data).where(eq(tableSchema.id, payload.id)).returning() as any[];
        return updated[0];
      }

      case 'delete':
        await db.delete(tableSchema).where(eq(tableSchema.id, payload));
        return;

      default:
        throw new Error(`Operation "${operation}" not supported`);
    }
  });

  console.log('IPC handlers ready - All schema tables automatically supported');
}
