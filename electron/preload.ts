import { contextBridge, ipcRenderer } from 'electron';

const api = {
  records: {
    getAll: () => ipcRenderer.invoke('db:records:getAll'),
    create: () => ipcRenderer.invoke('db:records:create'),
  },
};

contextBridge.exposeInMainWorld('electronAPI', api);

export type ElectronAPI = typeof api;
