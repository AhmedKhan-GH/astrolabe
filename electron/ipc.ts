import { ipcMain, dialog, shell } from 'electron';
import { getDatabase, reinitDatabase } from './database';
import { getMainWindow } from './main';

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getDataDirectory, promptForDataDirectory, resetDataDirectory, selectDatabaseFile, createDatabaseFile } from './settings';
import { FileTreeOperations } from '../src/db/FileTreeOperations';

/**
 * Constructs full file path from hash and filename
 * Structure: data/files/{hash}/{filename}
 */
function getFilePathFromHash(hash: string, filename: string): string {
  const dataDir = getDataDirectory();
  const filesDir = path.join(dataDir, 'files');
  return path.join(filesDir, hash, filename);
}

export function setupIpcHandlers() {

  ipcMain.handle('selectAndImportFiles', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'PDF Files', extensions: ['pdf'] }
      ]
    });

    if (result.canceled || result.filePaths.length === 0) {
      return [];
    }

    return importFiles(result.filePaths);
  });

  ipcMain.handle('selectAndImportFilesToFolder', async (_, folderId: number) => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'PDF Files', extensions: ['pdf'] }
      ]
    });

    if (result.canceled || result.filePaths.length === 0) {
      return [];
    }

    return importFiles(result.filePaths, folderId);
  });

  ipcMain.handle('selectAndReferenceFiles', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'PDF Files', extensions: ['pdf'] }
      ]
    });

    if (result.canceled || result.filePaths.length === 0) {
      return [];
    }

    return referenceFiles(result.filePaths);
  });

  ipcMain.handle('selectAndReferenceFilesToFolder', async (_, folderId: number) => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'PDF Files', extensions: ['pdf'] }
      ]
    });

    if (result.canceled || result.filePaths.length === 0) {
      return [];
    }

    return referenceFiles(result.filePaths, folderId);
  });

  async function importFiles(filePaths: string[], folderId?: number) {
    const db = getDatabase();
    const fileOps = new FileTreeOperations(db);

    // Create files directory adjacent to database
    const dataDir = getDataDirectory();
    const filesDir = path.join(dataDir, 'files');

    if (!fs.existsSync(filesDir)) {
      fs.mkdirSync(filesDir, { recursive: true });
    }

    const importedFiles = [];

    for (const filePath of filePaths) {

      const filename = path.basename(filePath);

      // Generate hash for folder name
      const hash = crypto.randomBytes(8).toString('hex');
      const hashDir = path.join(filesDir, hash);

      // Create hash directory
      if (!fs.existsSync(hashDir)) {
        fs.mkdirSync(hashDir, { recursive: true });
      }

      // Store file with original filename inside hash directory
      const storedPath = path.join(hashDir, filename);

      // Copy file to storage
      fs.copyFileSync(filePath, storedPath);

      try {
        // Use importFile to handle duplicates with user confirmation
        // folderId = 0 means root, folderId > 0 means specific folder
        // Store only the hash as path (hashDir contains: file, thumbnail, metadata, etc)
        const ext = path.extname(filePath);
        const result = await fileOps.importFile(
          filename,
          hash,  // Store only hash path
          ext ? ext.slice(1) : null,
          folderId !== undefined ? folderId : 0,
          async (existingFile) => {
            // Show confirmation dialog to user with details about existing file
            const addedDate = existingFile.addedAt
              ? new Date(existingFile.addedAt).toLocaleString()
              : 'Unknown';

            const response = await dialog.showMessageBox({
              type: 'question',
              buttons: ['Cancel', 'Update'],
              defaultId: 1,
              title: 'File Already Exists',
              message: `File "${filename}" already exists in the database.`,
              detail: `Existing file:\n• Hash: ${existingFile.path}\n• Added: ${addedDate}\n\nDo you want to update the existing file entry with the new path and add it to this location?`
            });
            return response.response === 1; // 1 = Update button
          }
        );

        importedFiles.push(result.file);
      } catch (error) {
        // Show error dialog to user
        await dialog.showMessageBox({
          type: 'error',
          buttons: ['OK'],
          title: 'Import Failed',
          message: `Failed to import "${filename}"`,
          detail: error instanceof Error ? error.message : String(error)
        });

        // Clean up the copied file and hash directory since import failed
        if (fs.existsSync(storedPath)) {
          fs.unlinkSync(storedPath);
        }
        if (fs.existsSync(hashDir)) {
          try {
            fs.rmdirSync(hashDir);
          } catch (error) {
            console.error('Error cleaning up hash directory:', error);
          }
        }
      }
    }

    return importedFiles;
  }

  async function referenceFiles(filePaths: string[], folderId?: number) {
    const db = getDatabase();
    const fileOps = new FileTreeOperations(db);

    const referencedFiles = [];

    for (const filePath of filePaths) {
      const filename = path.basename(filePath);
      const ext = path.extname(filePath);

      try {
        // Store full system path as reference
        const result = await fileOps.importFile(
          filename,
          filePath,  // Store full system path
          ext ? ext.slice(1) : null,
          folderId !== undefined ? folderId : 0,
          async (existingFile) => {
            // Show confirmation dialog to user with details about existing file
            const addedDate = existingFile.addedAt
              ? new Date(existingFile.addedAt).toLocaleString()
              : 'Unknown';

            const response = await dialog.showMessageBox({
              type: 'question',
              buttons: ['Cancel', 'Update'],
              defaultId: 1,
              title: 'File Already Exists',
              message: `File "${filename}" already exists in the database.`,
              detail: `Existing file:\n• Path: ${existingFile.path}\n• Added: ${addedDate}\n\nDo you want to update the existing file entry with the new path and add it to this location?`
            });
            return response.response === 1; // 1 = Update button
          },
          'reference'  // Mark as reference type
        );

        referencedFiles.push(result.file);
      } catch (error) {
        // Show error dialog to user
        await dialog.showMessageBox({
          type: 'error',
          buttons: ['OK'],
          title: 'Reference Failed',
          message: `Failed to reference "${filename}"`,
          detail: error instanceof Error ? error.message : String(error)
        });
      }
    }

    return referencedFiles;
  }

  ipcMain.handle('getAllFiles', async () => {
    const db = getDatabase();
    const fileOps = new FileTreeOperations(db);
    return fileOps.getAllFiles();
  });

  ipcMain.handle('getAllFolders', async () => {
    const db = getDatabase();
    const fileOps = new FileTreeOperations(db);
    return fileOps.getAllFolders();
  });

  ipcMain.handle('createFolder', async (_, name: string, parentId?: number) => {
    console.log('createFolder called with name:', name, 'parentId:', parentId);
    const db = getDatabase();
    const fileOps = new FileTreeOperations(db);

    // Ensure parentId is 0 if undefined or null is passed
    const normalizedParentId = parentId ?? 0;
    const inserted = await fileOps.createFolder(name, normalizedParentId);
    console.log('Folder created:', inserted);
    return inserted;
  });

  ipcMain.handle('moveFile', async (_, fileId: number, folderId: number) => {
    console.log('moveFile called:', { fileId, folderId });
    const db = getDatabase();
    const fileOps = new FileTreeOperations(db);

    await fileOps.moveFile(fileId, folderId);
    console.log('File moved');
  });

  ipcMain.handle('includeFileInFolder', async (_, fileId: number, folderId: number) => {
    console.log('includeFileInFolder called:', { fileId, folderId });
    const db = getDatabase();
    const fileOps = new FileTreeOperations(db);

    // Convert folderId = 0 (root) to proper handling
    if (folderId === 0) {
      throw new Error('Cannot add file to root. Use "Move to" instead.');
    }

    await fileOps.addFileToFolder(fileId, folderId);
    console.log('File added to folder');
  });

  ipcMain.handle('moveFolder', async (_, folderId: number, newParentId: number) => {
    console.log('moveFolder called:', { folderId, newParentId });
    const db = getDatabase();
    const fileOps = new FileTreeOperations(db);

    await fileOps.moveFolder(folderId, newParentId);
    console.log('Folder moved');
  });

  ipcMain.handle('deleteFile', async (_, fileId: number) => {
    console.log('deleteFile called:', fileId);
    const db = getDatabase();
    const fileOps = new FileTreeOperations(db);

    // Get file info first to delete physical file
    const file = await fileOps.deleteFile(fileId);
    if (file && file.path) {
      // Construct hash directory path from stored hash
      const dataDir = getDataDirectory();
      const filesDir = path.join(dataDir, 'files');
      const hashDir = path.join(filesDir, file.path);

      // Delete entire hash directory (contains file, thumbnail, metadata, etc)
      if (fs.existsSync(hashDir)) {
        try {
          const files = fs.readdirSync(hashDir);
          for (const f of files) {
            fs.unlinkSync(path.join(hashDir, f));
          }
          fs.rmdirSync(hashDir);
        } catch (error) {
          console.error('Error deleting hash directory:', error);
        }
      }
    }

    console.log('File deleted');
  });

  ipcMain.handle('deleteFolder', async (_, folderId: number) => {
    console.log('deleteFolder called:', folderId);
    const db = getDatabase();
    const fileOps = new FileTreeOperations(db);

    await fileOps.deleteFolder(folderId);
    console.log('Folder deleted successfully');
  });

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

  ipcMain.handle('toggleFolderExpanded', async (_, folderId: number) => {
    const db = getDatabase();
    const fileOps = new FileTreeOperations(db);
    await fileOps.toggleFolderExpanded(folderId);
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

  console.log('IPC handlers ready');
}
