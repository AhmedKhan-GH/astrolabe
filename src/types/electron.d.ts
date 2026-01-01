import type { File } from '../db/schema';

export interface ElectronAPI {
  selectAndUploadFiles: () => Promise<File[]>;
  getAllFiles: () => Promise<File[]>;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
