import { contextBridge, ipcRenderer } from 'electron';
import * as schema from '../src/db/schema';

/**
 * Create type-safe table client for preload
 */
function createTableClient<TSelect, TInsert>(tableName: string) {
  return {
    getAll: (): Promise<TSelect[]> =>
      ipcRenderer.invoke('db:query', { table: tableName, operation: 'getAll' }),

    getById: (id: number): Promise<TSelect> =>
      ipcRenderer.invoke('db:query', { table: tableName, operation: 'getById', payload: id }),

    create: (data: Partial<TInsert>): Promise<TSelect> =>
      ipcRenderer.invoke('db:query', { table: tableName, operation: 'create', payload: data }),

    update: (id: number, data: Partial<TSelect>): Promise<TSelect> =>
      ipcRenderer.invoke('db:query', { table: tableName, operation: 'update', payload: { id, data } }),

    delete: (id: number): Promise<void> =>
      ipcRenderer.invoke('db:query', { table: tableName, operation: 'delete', payload: id }),
  };
}

/**
 * Automatically generate API clients for all tables using $inferSelect types
 */
function generateTableAPIs() {
  return {
    records: createTableClient<schema.Record, schema.NewRecord>('records'),
    users: createTableClient<schema.User, schema.NewUser>('users'),
    // Add new tables here with their inferred types:
    // tableName: createTableClient<schema.TableName, schema.NewTableName>('tableName'),
  };
}

/**
 * Exposed API - automatically includes all tables with proper $inferSelect types
 */
const api = {
  ...generateTableAPIs(),

  // ============================================================================
  // CUSTOM QUERIES - Add your complex queries here with proper return types
  // ============================================================================

  // Working example: Search records by title (case-insensitive)
  searchRecordsByTitle: (searchTerm: string): Promise<schema.Record[]> =>
    ipcRenderer.invoke('db:custom', { query: 'searchRecordsByTitle', payload: searchTerm }),

  // Add more custom queries here with inferred types:
  // getUserWithRecords: (userId: number): Promise<schema.User & { records: schema.Record[] }> =>
  //   ipcRenderer.invoke('db:custom', { query: 'getUserWithRecords', payload: userId }),
  //
  // getRecordStats: (): Promise<{ total: number; avgValue: number }> =>
  //   ipcRenderer.invoke('db:custom', { query: 'getRecordStats' }),
  // ============================================================================
};

contextBridge.exposeInMainWorld('electronAPI', api);

export type ElectronAPI = typeof api;
