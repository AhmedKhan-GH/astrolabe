import type { File } from '../db/schema';

export interface ElectronAPI {
  selectAndUploadFiles: () => Promise<File[]>;
  getAllFiles: () => Promise<File[]>;
  getDataDirectory: () => Promise<string>;
  chooseDataDirectory: () => Promise<string | null>;
  resetDataDirectory: () => Promise<string>;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
