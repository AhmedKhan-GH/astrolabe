import { contextBridge, ipcRenderer } from 'electron';

const electronAPI = {
  selectAndUploadFiles: () => ipcRenderer.invoke('selectAndUploadFiles'),
  selectAndUploadFilesToFolder: (folderId: number) => ipcRenderer.invoke('selectAndUploadFilesToFolder', folderId),
  getAllFiles: () => ipcRenderer.invoke('getAllFiles'),
  getAllFolders: () => ipcRenderer.invoke('getAllFolders'),
  createFolder: (name: string, parentId?: number) => ipcRenderer.invoke('createFolder', name, parentId),
  moveFile: (fileId: number, folderId: number | null) => ipcRenderer.invoke('moveFile', fileId, folderId),
  includeFileInFolder: (fileId: number, folderId: number) => ipcRenderer.invoke('includeFileInFolder', fileId, folderId),
  moveFolder: (folderId: number, newParentId: number | null) => ipcRenderer.invoke('moveFolder', folderId, newParentId),
  deleteFile: (fileId: number) => ipcRenderer.invoke('deleteFile', fileId),
  deleteFolder: (folderId: number) => ipcRenderer.invoke('deleteFolder', folderId),
  getDataDirectory: () => ipcRenderer.invoke('getDataDirectory'),
  chooseDataDirectory: () => ipcRenderer.invoke('chooseDataDirectory'),
  resetDataDirectory: () => ipcRenderer.invoke('resetDataDirectory'),
};

contextBridge.exposeInMainWorld('electron', electronAPI);

export type ElectronAPI = typeof electronAPI;
