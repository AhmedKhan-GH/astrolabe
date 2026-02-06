import { ipcMain } from 'electron';
import { reinitDatabase } from '../database';
import { getMainWindow } from '../main';
import {
  getDataDirectory,
  promptForDataDirectory,
  resetDataDirectory,
  selectDatabaseFile,
  createDatabaseFile,
  getDatabasesList,
  getCurrentDatabase,
  setDataDirectory,
  resetToDefaultDatabase,
  deleteDatabase,
  getDefaultDatabasePath
} from '../settings';
import { shell } from 'electron';

import fs from 'fs';
import path from 'path';

/**
 * Sets up IPC handlers for database and settings operations
 */
export function setupDatabaseHandlers() {
  // Settings handlers
  ipcMain.handle('getDataDirectory', () => {
    return getDataDirectory();
  });

  ipcMain.handle('chooseDataDirectory', async () => {
    return await promptForDataDirectory();
  });

  ipcMain.handle('resetDataDirectory', () => {
    resetDataDirectory();
    return getDataDirectory();
  });

  ipcMain.handle('openFileInDefaultApp', async (_, filePath: string) => {
    await shell.openPath(filePath);
  });

  // Database picker handlers
  ipcMain.handle('selectDatabaseFile', async () => {
    console.log('[IPC] selectDatabaseFile called');
    const result = await selectDatabaseFile();
    console.log('[IPC] selectDatabaseFile result:', result);
    if (result) {
      console.log('[IPC] Switching to database:', result);
      // Reinitialize database with new path
      reinitDatabase();

      // Reload the window after a small delay to ensure database is ready
      console.log('[IPC] Setting timeout for window reload...');
      setTimeout(() => {
        const mainWindow = getMainWindow();
        console.log('[IPC] mainWindow:', mainWindow ? 'exists' : 'null');
        if (mainWindow) {
          console.log('[IPC] Reloading window with new database');
          mainWindow.webContents.reloadIgnoringCache();
        } else {
          console.error('[IPC] mainWindow is null, cannot reload');
        }
      }, 100);
    } else {
      console.log('[IPC] No database selected (user cancelled)');
    }
    return result;
  });

  ipcMain.handle('createDatabaseFile', async () => {
    console.log('[IPC] createDatabaseFile called');
    const result = await createDatabaseFile();
    console.log('[IPC] createDatabaseFile result:', result);
    if (result) {
      console.log('[IPC] Created new database:', result);
      // Reinitialize database with new path
      reinitDatabase();

      // Reload the window after a small delay to ensure database is ready
      console.log('[IPC] Setting timeout for window reload...');
      setTimeout(() => {
        const mainWindow = getMainWindow();
        console.log('[IPC] mainWindow:', mainWindow ? 'exists' : 'null');
        if (mainWindow) {
          console.log('[IPC] Reloading window with new database');
          mainWindow.webContents.reloadIgnoringCache();
        } else {
          console.error('[IPC] mainWindow is null, cannot reload');
        }
      }, 100);
    } else {
      console.log('[IPC] No database created (user cancelled)');
    }
    return result;
  });

  // Health check to verify current database path
  ipcMain.handle('getDatabaseHealth', () => {
    const dataDir = getDataDirectory();
    const dbPath = path.join(dataDir, 'astrolabe.db');
    const exists = fs.existsSync(dbPath);

    console.log('[Health Check] Current database path:', dbPath);
    console.log('[Health Check] Database exists:', exists);

    let isConnected = false;
    try {
      const { getDatabase } = require('../database');
      const db = getDatabase();
      isConnected = db !== null;
    } catch (error) {
      console.log('[Health Check] Database not connected:', error);
    }

    return {
      dataDirectory: dataDir,
      databasePath: dbPath,
      exists,
      isConnected
    };
  });

  ipcMain.handle('getDatabasesList', () => {
    return getDatabasesList();
  });

  ipcMain.handle('getCurrentDatabase', () => {
    return getCurrentDatabase();
  });

  ipcMain.handle('getDefaultDatabasePath', () => {
    return getDefaultDatabasePath();
  });

  ipcMain.handle('switchToDatabase', async (_, dbPath: string) => {
    console.log('[IPC] switchToDatabase called with:', dbPath);
    setDataDirectory(dbPath);

    // Reinitialize database with new path
    reinitDatabase();

    // Reload the window after a small delay to ensure database is ready
    console.log('[IPC] Setting timeout for window reload...');
    setTimeout(() => {
      const mainWindow = getMainWindow();
      console.log('[IPC] mainWindow:', mainWindow ? 'exists' : 'null');
      if (mainWindow) {
        console.log('[IPC] Reloading window with new database');
        mainWindow.webContents.reloadIgnoringCache();
      } else {
        console.error('[IPC] mainWindow is null, cannot reload');
      }
    }, 100);

    return dbPath;
  });

  ipcMain.handle('switchToDefaultDatabase', async () => {
    console.log('[IPC] switchToDefaultDatabase called');
    const defaultPath = resetToDefaultDatabase();

    // Reinitialize database with default path
    reinitDatabase();

    // Reload the window after a small delay to ensure database is ready
    console.log('[IPC] Setting timeout for window reload...');
    setTimeout(() => {
      const mainWindow = getMainWindow();
      console.log('[IPC] mainWindow:', mainWindow ? 'exists' : 'null');
      if (mainWindow) {
        console.log('[IPC] Reloading window with default database');
        mainWindow.webContents.reloadIgnoringCache();
      } else {
        console.error('[IPC] mainWindow is null, cannot reload');
      }
    }, 100);

    return defaultPath;
  });

  ipcMain.handle('deleteDatabase', async (_, dbPath: string) => {
    console.log('[IPC] deleteDatabase called with:', dbPath);
    deleteDatabase(dbPath);
    console.log('[IPC] Database deleted');
  });
}
