/// <reference types="vite/client" />

interface ElectronAPI {
  records: {
    getAll: () => Promise<any[]>;
    create: () => Promise<any>;
  };
}

interface Window {
  electronAPI: ElectronAPI;
}
