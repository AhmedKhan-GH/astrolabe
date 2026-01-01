/// <reference types="vite/client" />

interface ElectronAPI {
  users: {
    getAll: () => Promise<any[]>;
    create: (data: { name: string; email: string }) => Promise<any>;
    delete: (id: number) => Promise<{ success: boolean }>;
  };
  notes: {
    getAll: () => Promise<any[]>;
    getByUser: (userId: number) => Promise<any[]>;
    create: (data: { title: string; content?: string; userId?: number }) => Promise<any>;
    update: (id: number, data: { title?: string; content?: string }) => Promise<any>;
    delete: (id: number) => Promise<{ success: boolean }>;
  };
}

interface Window {
  electronAPI: ElectronAPI;
}
