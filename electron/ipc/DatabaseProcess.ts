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
import { logger } from '../utils/logger';

import fs from 'fs';
import path from 'path';

/**
 * Sets up IPC handlers for database and settings processes
 */
export function setupDatabaseProcessHandlers() {
  // Remove existing handlers first to prevent duplicates
  const handlers = [
    'getDataDirectory',
    'chooseDataDirectory',
    'resetDataDirectory',
    'openFileInDefaultApp',
    'selectDatabaseFile',
    'createDatabaseFile',
    'getDatabaseHealth',
    'getDatabasesList',
    'getCurrentDatabase',
    'getDefaultDatabasePath',
    'switchToDatabase',
    'switchToDefaultDatabase',
    'deleteDatabase'
  ];

  handlers.forEach(handler => ipcMain.removeHandler(handler));

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
    logger.info('[IPC] selectDatabaseFile - Opening file picker dialog...');
    const result = await selectDatabaseFile();

    if (result) {
      logger.info({ databasePath: result }, '[IPC] User selected database');
      logger.info('[IPC] Reinitializing database with selected path...');

      // Reinitialize database with new path
      reinitDatabase();

      // Reload the window after a small delay to ensure database is ready
      logger.debug('[IPC] Scheduling window reload (100ms delay)...');
      setTimeout(() => {
        const mainWindow = getMainWindow();
        if (mainWindow) {
          logger.info('[IPC] Reloading renderer window with new database');
          mainWindow.webContents.reloadIgnoringCache();
        } else {
          logger.error('[IPC] Cannot reload - mainWindow is null');
        }
      }, 100);
    } else {
      logger.info('[IPC] Database selection cancelled by user');
    }
    return result;
  });

  ipcMain.handle('createDatabaseFile', async () => {
    logger.info('[IPC] createDatabaseFile - Opening create dialog...');
    const result = await createDatabaseFile();

    if (result) {
      logger.info({ databasePath: result }, '[IPC] New database created successfully');
      logger.info('[IPC] Reinitializing database with new path...');

      // Reinitialize database with new path
      reinitDatabase();

      // Reload the window after a small delay to ensure database is ready
      logger.debug('[IPC] Scheduling window reload (100ms delay)...');
      setTimeout(() => {
        const mainWindow = getMainWindow();
        if (mainWindow) {
          logger.info('[IPC] Reloading renderer window with new database');
          mainWindow.webContents.reloadIgnoringCache();
        } else {
          logger.error('[IPC] Cannot reload - mainWindow is null');
        }
      }, 100);
    } else {
      logger.info('[IPC] Database creation cancelled by user');
    }
    return result;
  });

  // Health check to verify current database path
  ipcMain.handle('getDatabaseHealth', () => {
    logger.debug('[IPC] getDatabaseHealth - Running health check...');

    const dataDir = getDataDirectory();
    const dbPath = path.join(dataDir, 'astrolabe.db');
    const exists = fs.existsSync(dbPath);

    let isConnected = false;
    try {
      const { getDatabase } = require('../database');
      const db = getDatabase();
      isConnected = db !== null;
    } catch (error) {
      logger.debug({ error }, '[Health Check] Database connection check failed');
    }

    const health = {
      dataDirectory: dataDir,
      databasePath: dbPath,
      exists,
      isConnected
    };

    logger.info({
      dbPath,
      exists,
      isConnected,
      status: exists && isConnected ? 'healthy' : 'unhealthy'
    }, `[Health Check] Database status: ${exists && isConnected ? 'healthy' : 'unhealthy'}`);

    return health;
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
    logger.info({ dbPath }, '[IPC] switchToDatabase - Switching to existing database');
    setDataDirectory(dbPath);

    // Reinitialize database with new path
    logger.info('[IPC] Reinitializing database...');
    reinitDatabase();

    // Reload the window after a small delay to ensure database is ready
    logger.debug('[IPC] Scheduling window reload (100ms delay)...');
    setTimeout(() => {
      const mainWindow = getMainWindow();
      if (mainWindow) {
        logger.info('[IPC] Reloading renderer window with switched database');
        mainWindow.webContents.reloadIgnoringCache();
      } else {
        logger.error('[IPC] Cannot reload - mainWindow is null');
      }
    }, 100);

    logger.info('[IPC] Database switch complete');
    return dbPath;
  });

  ipcMain.handle('switchToDefaultDatabase', async () => {
    logger.info('[IPC] switchToDefaultDatabase - Switching to default database');
    const defaultPath = resetToDefaultDatabase();

    // Reinitialize database with default path
    logger.info('[IPC] Reinitializing database...');
    reinitDatabase();

    // Reload the window after a small delay to ensure database is ready
    logger.debug('[IPC] Scheduling window reload (100ms delay)...');
    setTimeout(() => {
      const mainWindow = getMainWindow();
      if (mainWindow) {
        logger.info('[IPC] Reloading window with default database');
        mainWindow.webContents.reloadIgnoringCache();
      } else {
        logger.error('[IPC] Cannot reload - mainWindow is null');
      }
    }, 100);

    logger.info('[IPC] Switched to default database');
    return defaultPath;
  });

  ipcMain.handle('deleteDatabase', async (_, dbPath: string) => {
    logger.info({ dbPath }, '[IPC] deleteDatabase - Deleting database');
    deleteDatabase(dbPath);
    logger.info({ dbPath }, '[IPC] Database deleted successfully');
  });
}
