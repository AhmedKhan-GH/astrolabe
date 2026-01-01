import { ipcMain } from 'electron';
import { getDatabase } from './database';
import { eq } from 'drizzle-orm';
import * as schema from '../src/db/schema';

/**
 * Remove undefined values from an object to prevent database errors
 */
function cleanPayload<T extends Record<string, unknown>>(payload: T | null | undefined): Partial<T> {
  if (!payload) return {};
  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined)
  ) as Partial<T>;
}

/**
 * Single generic IPC handler for ALL database operations
 * Add a table to schema.ts → it works automatically here
 */
export function setupIpcHandlers() {
  ipcMain.handle('db:query', async (_event, { table, operation, payload }: {
    table: string;
    operation: string;
    payload?: unknown;
  }) => {
    const db = getDatabase();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tableSchema = (schema as any)[table];

    if (!tableSchema) {
      throw new Error(`Table "${table}" not found`);
    }

    switch (operation) {
      case 'getAll':
        return db.select().from(tableSchema);

      case 'getById':
        return db.select().from(tableSchema).where(eq(tableSchema.id, payload));

      case 'create': {
        const created = await db.insert(tableSchema).values(cleanPayload(payload as Record<string, unknown>)).returning() as unknown[];
        return created[0];
      }

      case 'update': {
        const payloadData = payload as { id: number; data: Record<string, unknown> };
        const updated = await db
          .update(tableSchema)
          .set(cleanPayload(payloadData.data))
          .where(eq(tableSchema.id, payloadData.id))
          .returning() as unknown[];
        return updated[0];
      }

      case 'delete':
        return db.delete(tableSchema).where(eq(tableSchema.id, payload));

      default:
        throw new Error(`Operation "${operation}" not supported`);
    }
  });

  console.log('IPC handlers ready - All schema tables automatically supported');
}
