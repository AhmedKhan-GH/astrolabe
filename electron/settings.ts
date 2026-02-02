import ElectronStore from 'electron-store';
import { app, dialog } from 'electron';
import path from 'path';
import fs from 'fs';

// Load .env in development
if (!app.isPackaged) {
  require('dotenv').config();
}

interface Settings {
  dataDirectory?: string;
}

type StoreType = ElectronStore<Settings> & {
  get<K extends keyof Settings>(key: K): Settings[K];
  set<K extends keyof Settings>(key: K, value: Settings[K]): void;
  delete<K extends keyof Settings>(key: K): void;
};

const store = new ElectronStore<Settings>({
  name: 'settings',
  defaults: {
    dataDirectory: undefined
  }
}) as StoreType;

/**
 * Get the data directory path. If not set by user, returns default location.
 * Creates the .astro directory bundle if it doesn't exist.
 */
export function getDataDirectory(): string {
  const customPath = store.get('dataDirectory');

  // Check for .env DATA_DIR in development
  let dataPath: string;
  if (!app.isPackaged && process.env.DATA_DIR) {
    // Resolve relative path from app root
    dataPath = path.resolve(app.getAppPath(), process.env.DATA_DIR);
  } else {
    dataPath = customPath || path.join(app.getPath('userData'), 'data');
  }

  // Ensure the directory exists (creates .astro as a directory bundle)
  if (!fs.existsSync(dataPath)) {
    fs.mkdirSync(dataPath, { recursive: true });
  }

  return dataPath;
}

/**
 * Set a custom data directory path
 */
export function setDataDirectory(dirPath: string): void {
  store.set('dataDirectory', dirPath);
}

/**
 * Show a dialog to let user choose/create an .astro data file
 */
export async function promptForDataDirectory(): Promise<string | null> {
  const result = await dialog.showSaveDialog({
    title: 'Choose Astrolabe Data File',
    buttonLabel: 'Select',
    defaultPath: 'MyData.astro'
  });

  if (result.canceled || !result.filePath) {
    return null;
  }

  let selectedPath = result.filePath;

  // Ensure .astro extension
  if (!selectedPath.endsWith('.astro')) {
    selectedPath += '.astro';
  }

  setDataDirectory(selectedPath);
  return selectedPath;
}

/**
 * Reset to default data directory
 */
export function resetDataDirectory(): void {
  store.delete('dataDirectory');
}
