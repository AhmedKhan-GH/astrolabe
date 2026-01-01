import { contextBridge, ipcRenderer } from 'electron';
import type { Record, NewRecord, User, NewUser } from '../src/db/schema';

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
 * Exposed API - matches what frontend expects
 * Types flow from schema.ts automatically
 */
const api = {
  records: createTableClient<Record, NewRecord>('records'),
  users: createTableClient<User, NewUser>('users'),
  // Add new tables here - one line per table
};

contextBridge.exposeInMainWorld('electronAPI', api);

export type ElectronAPI = typeof api;
