import { ipcMain, app, dialog } from 'electron';
import { getDatabase } from './database';
import * as schema from '../src/db/schema';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getDataDirectory, promptForDataDirectory, resetDataDirectory } from './settings';

export function setupIpcHandlers() {
  ipcMain.handle('selectAndUploadFiles', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'PDF Files', extensions: ['pdf'] }
      ]
    });

    if (result.canceled || result.filePaths.length === 0) {
      return [];
    }

    return uploadFiles(result.filePaths);
  });

  async function uploadFiles(filePaths: string[]) {
    const db = getDatabase();

    // Create files directory adjacent to database
    const dataDir = getDataDirectory();
    const filesDir = path.join(dataDir, 'files');

    if (!fs.existsSync(filesDir)) {
      fs.mkdirSync(filesDir, { recursive: true });
    }

    const uploadedFiles = [];

    for (const filePath of filePaths) {
      const stats = fs.statSync(filePath);
      const filename = path.basename(filePath);

      // Generate unique filename to avoid collisions
      const hash = crypto.randomBytes(8).toString('hex');
      const ext = path.extname(filename);
      const storedFilename = `${hash}${ext}`;
      const storedPath = path.join(filesDir, storedFilename);

      // Copy file to storage
      fs.copyFileSync(filePath, storedPath);

      // Insert metadata into database
      const inserted = await db.insert(schema.files).values({
        filename,
        path: storedPath,
        filetype: ext ? ext.slice(1) : null, // Remove leading dot from extension
      }).returning();

      uploadedFiles.push(inserted[0]);
    }

    return uploadedFiles;
  }

  ipcMain.handle('getAllFiles', async () => {
    const db = getDatabase();
    return db.select().from(schema.files);
  });

  ipcMain.handle('getAllFolders', async () => {
    const db = getDatabase();
    return db.select().from(schema.folders);
  });

  ipcMain.handle('createFolder', async (_, name: string, parentId?: number) => {
    const db = getDatabase();
    const inserted = await db.insert(schema.folders).values({
      name,
      parentId: parentId || null,
    }).returning();
    return inserted[0];
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

  console.log('IPC handlers ready');
}
