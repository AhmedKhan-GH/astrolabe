import { ipcMain, app, dialog } from 'electron';
import { getDatabase } from './database';
import * as schema from '../src/db/schema';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export function setupIpcHandlers() {
  ipcMain.handle('selectAndUploadFiles', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections']
    });

    if (result.canceled || result.filePaths.length === 0) {
      return [];
    }

    return uploadFiles(result.filePaths);
  });

  async function uploadFiles(filePaths: string[]) {
    const db = getDatabase();

    // Create files directory adjacent to database
    const userDataPath = app.getPath('userData');
    const filesDir = path.join(userDataPath, 'files');

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
        originalPath: filePath,
        storedPath,
        size: stats.size,
        mimeType: null, // Can add mime-type detection if needed
      }).returning();

      uploadedFiles.push(inserted[0]);
    }

    return uploadedFiles;
  }

  ipcMain.handle('getAllFiles', async () => {
    const db = getDatabase();
    return db.select().from(schema.files);
  });

  console.log('IPC handlers ready');
}
