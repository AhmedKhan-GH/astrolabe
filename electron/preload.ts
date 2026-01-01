import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  selectAndUploadFiles: () => ipcRenderer.invoke('selectAndUploadFiles'),
  getAllFiles: () => ipcRenderer.invoke('getAllFiles'),
});
