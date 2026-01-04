import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  selectAndUploadFiles: () => ipcRenderer.invoke('selectAndUploadFiles'),
  getAllFiles: () => ipcRenderer.invoke('getAllFiles'),
  getDataDirectory: () => ipcRenderer.invoke('getDataDirectory'),
  chooseDataDirectory: () => ipcRenderer.invoke('chooseDataDirectory'),
  resetDataDirectory: () => ipcRenderer.invoke('resetDataDirectory'),
});
