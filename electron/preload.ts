import { contextBridge, ipcRenderer } from 'electron';

const electronAPI = {
  selectAndUploadFiles: () => ipcRenderer.invoke('selectAndUploadFiles'),
  getAllFiles: () => ipcRenderer.invoke('getAllFiles'),
  getAllFolders: () => ipcRenderer.invoke('getAllFolders'),
  createFolder: (name: string, parentId?: number) => ipcRenderer.invoke('createFolder', name, parentId),
  getDataDirectory: () => ipcRenderer.invoke('getDataDirectory'),
  chooseDataDirectory: () => ipcRenderer.invoke('chooseDataDirectory'),
  resetDataDirectory: () => ipcRenderer.invoke('resetDataDirectory'),
};

contextBridge.exposeInMainWorld('electron', electronAPI);

export type ElectronAPI = typeof electronAPI;
