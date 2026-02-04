import ElectronStore from 'electron-store';
import { app, dialog } from 'electron';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';

// Load .env in development
if (!app.isPackaged) {
  dotenv.config();
}

interface Settings {
  dataDirectory?: string;
  databases?: string[];
}

type StoreType = ElectronStore<Settings> & {
  get<K extends keyof Settings>(key: K): Settings[K];
  set<K extends keyof Settings>(key: K, value: Settings[K]): void;
  delete<K extends keyof Settings>(key: K): void;
};

const store = new ElectronStore<Settings>({
  name: 'settings',
  defaults: {
    dataDirectory: undefined,
    databases: []
  }
}) as StoreType;

/**
 * Get the data directory path with correct precedence:
 * 1. Custom user selection (from database picker)
 * 2. .env DATA_DIR (development only)
 * 3. Default OS location
 */
export function getDataDirectory(): string {
  const customPath = store.get('dataDirectory');
  console.log('[getDataDirectory] Custom path from store:', customPath);

  // Precedence: custom > .env > default
  let dataPath: string;
  if (customPath) {
    // User explicitly selected a database location
    console.log('[getDataDirectory] Using custom path');
    dataPath = customPath;
  } else if (!app.isPackaged && process.env.DATA_DIR) {
    // Development mode with .env override
    console.log('[getDataDirectory] Using .env DATA_DIR');
    dataPath = path.resolve(app.getAppPath(), process.env.DATA_DIR);
  } else {
    // Default location
    console.log('[getDataDirectory] Using default path');
    dataPath = path.join(app.getPath('userData'), 'data');
  }

  console.log('[getDataDirectory] Final path:', dataPath);

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
  console.log('[setDataDirectory] Setting custom database path to:', dirPath);
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

/**
 * Add a database path to the list if it doesn't already exist
 */
export function addDatabaseToList(dbPath: string): void {
  const databases = store.get('databases') || [];
  if (!databases.includes(dbPath)) {
    databases.push(dbPath);
    store.set('databases', databases);
  }
}

/**
 * Get the list of all databases
 */
export function getDatabasesList(): string[] {
  return store.get('databases') || [];
}

/**
 * Get the current database path
 */
export function getCurrentDatabase(): string | null {
  return store.get('dataDirectory') || null;
}

/**
 * Get the default system database path (without custom override)
 */
export function getDefaultDatabasePath(): string {
  let dataPath: string;
  if (!app.isPackaged && process.env.DATA_DIR) {
    // Development mode with .env override
    dataPath = path.resolve(app.getAppPath(), process.env.DATA_DIR);
  } else {
    // Default location
    dataPath = path.join(app.getPath('userData'), 'data');
  }

  // Ensure the directory exists
  if (!fs.existsSync(dataPath)) {
    fs.mkdirSync(dataPath, { recursive: true });
  }

  return dataPath;
}

/**
 * Reset to system default database
 */
export function resetToDefaultDatabase(): string {
  store.delete('dataDirectory');
  return getDefaultDatabasePath();
}

/**
 * Select an existing .astro database directory
 * Note: On macOS with Info.plist, .astro appears as a package but we select it as a directory
 */
export async function selectDatabaseFile(): Promise<string | null> {
  const result = await dialog.showOpenDialog({
    title: 'Open Astrolabe Database',
    buttonLabel: 'Open',
    properties: ['openDirectory'],
    message: 'Select an .astro database directory'
  });

  if (result.canceled || !result.filePaths[0]) {
    return null;
  }

  const selectedPath = result.filePaths[0];

  // Verify it's an .astro directory
  if (!selectedPath.endsWith('.astro')) {
    const response = await dialog.showMessageBox({
      type: 'question',
      buttons: ['Cancel', 'Use Anyway'],
      defaultId: 0,
      title: 'Not an .astro Database',
      message: 'The selected directory does not have a .astro extension.',
      detail: 'Do you want to use it anyway? This may cause issues.'
    });

    if (response.response === 0) {
      return null;
    }
  }

  setDataDirectory(selectedPath);
  addDatabaseToList(selectedPath);
  return selectedPath;
}

/**
 * Create a new .astro database directory as a macOS package bundle
 */
export async function createDatabaseFile(): Promise<string | null> {
  const result = await dialog.showSaveDialog({
    title: 'Create Astrolabe Database',
    buttonLabel: 'Create',
    defaultPath: 'MyDatabase.astro',
    message: 'Create a new .astro database directory'
  });

  if (result.canceled || !result.filePath) {
    return null;
  }

  let selectedPath = result.filePath;

  // Ensure .astro extension
  if (!selectedPath.endsWith('.astro')) {
    selectedPath += '.astro';
  }

  // Create the directory if it doesn't exist
  if (!fs.existsSync(selectedPath)) {
    fs.mkdirSync(selectedPath, { recursive: true });

    // Create Info.plist to make it a macOS package bundle
    const plistContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleIdentifier</key>
    <string>com.astrolabe.database</string>
    <key>CFBundleName</key>
    <string>Astrolabe Database</string>
    <key>CFBundlePackageType</key>
    <string>BNDL</string>
</dict>
</plist>`;

    const plistPath = path.join(selectedPath, 'Info.plist');
    fs.writeFileSync(plistPath, plistContent, 'utf8');
  }

  setDataDirectory(selectedPath);
  addDatabaseToList(selectedPath);
  return selectedPath;
}

/**
 * Delete a database from the list and optionally delete its files
 * If it's the system default, reset it instead of deleting
 */
export function deleteDatabase(dbPath: string): void {
  const defaultPath = getDefaultDatabasePath();

  // If deleting system default, just reset it
  if (dbPath === defaultPath || path.basename(dbPath) === 'data') {
    // Remove all contents from the data directory
    if (fs.existsSync(dbPath)) {
      const files = fs.readdirSync(dbPath);
      for (const file of files) {
        const filePath = path.join(dbPath, file);
        const stat = fs.statSync(filePath);
        if (stat.isDirectory()) {
          fs.rmSync(filePath, { recursive: true, force: true });
        } else {
          fs.unlinkSync(filePath);
        }
      }
    }
  } else {
    // Delete the database file/directory
    if (fs.existsSync(dbPath)) {
      fs.rmSync(dbPath, { recursive: true, force: true });
    }

    // Remove from databases list
    const databases = getDatabasesList();
    const filtered = databases.filter(db => db !== dbPath);
    store.set('databases', filtered);
  }
}

