import type { File } from '../db/schema';

export interface ElectronAPI {
  selectAndUploadFiles: () => Promise<File[]>;
  selectAndUploadFilesToFolder: (folderId: number) => Promise<File[]>;
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
}

declare global {
  interface Window {
    electron: ElectronAPI;
  }
}
