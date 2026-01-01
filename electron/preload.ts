import { contextBridge, ipcRenderer } from 'electron';

const api = {
  users: {
    getAll: () => ipcRenderer.invoke('db:users:getAll'),
    create: (data: { name: string; email: string }) => ipcRenderer.invoke('db:users:create', data),
    delete: (id: number) => ipcRenderer.invoke('db:users:delete', id),
  },
  notes: {
    getAll: () => ipcRenderer.invoke('db:notes:getAll'),
    getByUser: (userId: number) => ipcRenderer.invoke('db:notes:getByUser', userId),
    create: (data: { title: string; content?: string; userId?: number }) => 
      ipcRenderer.invoke('db:notes:create', data),
    update: (id: number, data: { title?: string; content?: string }) => 
      ipcRenderer.invoke('db:notes:update', id, data),
    delete: (id: number) => ipcRenderer.invoke('db:notes:delete', id),
  },
};

contextBridge.exposeInMainWorld('electronAPI', api);

export type ElectronAPI = typeof api;
