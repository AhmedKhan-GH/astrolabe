import type { File } from '../db/schema';

export interface ElectronAPI {
  selectAndImportFiles: () => Promise<File[]>;
  selectAndImportFilesToFolder: (folderId: number) => Promise<File[]>;
  selectAndReferenceFiles: () => Promise<File[]>;
  selectAndReferenceFilesToFolder: (folderId: number) => Promise<File[]>;
  getAllFiles: () => Promise<File[]>;
  getAllFolders: () => Promise<any[]>;
  createFolder: (name: string, parentId?: number) => Promise<any>;
  moveFile: (fileId: number, folderId: number | null) => Promise<void>;
  includeFileInFolder: (fileId: number, folderId: number) => Promise<void>;
  moveFolder: (folderId: number, newParentId: number | null) => Promise<void>;
  deleteFile: (fileId: number) => Promise<void>;
  deleteFolder: (folderId: number) => Promise<void>;
  getDataDirectory: () => Promise<string>;
  chooseDataDirectory: () => Promise<string | null>;
  resetDataDirectory: () => Promise<string>;
  openFileInDefaultApp: (filePath: string) => Promise<void>;
  toggleFolderExpanded: (folderId: number) => Promise<void>;
  selectDatabaseFile: () => Promise<string | null>;
  createDatabaseFile: () => Promise<string | null>;
  getDatabaseHealth: () => Promise<{
    dataDirectory: string;
    databasePath: string;
    exists: boolean;
    isConnected: boolean;
  }>;
  getDatabasesList: () => Promise<string[]>;
  getCurrentDatabase: () => Promise<string | null>;
  switchToDatabase: (dbPath: string) => Promise<string>;
  switchToDefaultDatabase: () => Promise<string>;
}

declare global {
  interface Window {
    electron: ElectronAPI;
  }
}
