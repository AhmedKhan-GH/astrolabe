import { contextBridge, ipcRenderer } from 'electron';

/**
 * List of all database tables
 * Add new table names here (must match schema.ts) and they'll be auto-exposed
 */
const TABLE_NAMES = ['records', 'users'] as const;

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
 * Automatically generate API clients for all tables
 */
function generateTableAPIs() {
  const api: Record<string, ReturnType<typeof createTableClient>> = {};

  // Automatically create clients for all tables in TABLE_NAMES
  for (const tableName of TABLE_NAMES) {
    api[tableName] = createTableClient(tableName);
  }

  return api;
}

/**
 * Exposed API - automatically includes all tables from TABLE_NAMES
 * Just add table names to the array above and they'll be exposed automatically!
 */
const api = {
  ...generateTableAPIs(),

  // ============================================================================
  // CUSTOM QUERIES - Add your complex queries here
  // ============================================================================

  // Working example: Search records by title (case-insensitive)
  searchRecordsByTitle: (searchTerm: string) => 
    ipcRenderer.invoke('db:custom', { query: 'searchRecordsByTitle', payload: searchTerm }),

  // Add more custom queries here:
  // getUserWithRecords: (userId: number) => 
  //   ipcRenderer.invoke('db:custom', { query: 'getUserWithRecords', payload: userId }),
  //
  // getRecordStats: () => 
  //   ipcRenderer.invoke('db:custom', { query: 'getRecordStats' }),
  // ============================================================================
};

contextBridge.exposeInMainWorld('electronAPI', api);

export type ElectronAPI = typeof api;
