import { contextBridge, ipcRenderer } from 'electron';

const electronAPI = {
  selectAndImportFiles: () => ipcRenderer.invoke('selectAndImportFiles'),
  selectAndImportFilesToFolder: (folderId: number) => ipcRenderer.invoke('selectAndImportFilesToFolder', folderId),
  selectAndReferenceFiles: () => ipcRenderer.invoke('selectAndReferenceFiles'),
  selectAndReferenceFilesToFolder: (folderId: number) => ipcRenderer.invoke('selectAndReferenceFilesToFolder', folderId),
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
  openFileInDefaultApp: (filePath: string) => ipcRenderer.invoke('openFileInDefaultApp', filePath),
  toggleFolderExpanded: (folderId: number) => ipcRenderer.invoke('toggleFolderExpanded', folderId),
  selectDatabaseFile: () => ipcRenderer.invoke('selectDatabaseFile'),
  createDatabaseFile: () => ipcRenderer.invoke('createDatabaseFile'),
  getDatabaseHealth: () => ipcRenderer.invoke('getDatabaseHealth'),
};

contextBridge.exposeInMainWorld('electron', electronAPI);

export type ElectronAPI = typeof electronAPI;
