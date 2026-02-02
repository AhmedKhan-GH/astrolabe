import { ipcMain, dialog } from 'electron';
import { getDatabase } from './database';

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getDataDirectory, promptForDataDirectory, resetDataDirectory } from './settings';
import { FileTreeOperations } from '../src/db/FileTreeOperations';

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

  ipcMain.handle('selectAndUploadFilesToFolder', async (_, folderId: number) => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'PDF Files', extensions: ['pdf'] }
      ]
    });

    if (result.canceled || result.filePaths.length === 0) {
      return [];
    }

    return uploadFiles(result.filePaths, folderId);
  });

  async function uploadFiles(filePaths: string[], folderId?: number) {
    const db = getDatabase();
    const fileOps = new FileTreeOperations(db);

    // Create files directory adjacent to database
    const dataDir = getDataDirectory();
    const filesDir = path.join(dataDir, 'files');

    if (!fs.existsSync(filesDir)) {
      fs.mkdirSync(filesDir, { recursive: true });
    }

    const uploadedFiles = [];

    for (const filePath of filePaths) {

      const filename = path.basename(filePath);

      // Generate unique filename to avoid collisions
      const hash = crypto.randomBytes(8).toString('hex');
      const ext = path.extname(filePath);
      const storedFilename = `${hash}${ext}`;
      const storedPath = path.join(filesDir, storedFilename);

      // Copy file to storage
      fs.copyFileSync(filePath, storedPath);

      // Use FileTreeOperations to enforce constraints
      const inserted = await fileOps.createFile(
        filename,
        storedPath,
        ext ? ext.slice(1) : null,
        folderId ? [folderId] : []
      );

      uploadedFiles.push(inserted);
    }

    return uploadedFiles;
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

    const inserted = await fileOps.createFolder(name, parentId || null);
    console.log('Folder created:', inserted);
    return inserted;
  });

  ipcMain.handle('moveFile', async (_, fileId: number, folderId: number | null) => {
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

    await fileOps.addFileToFolder(fileId, folderId);
    console.log('File added to folder');
  });

  ipcMain.handle('moveFolder', async (_, folderId: number, newParentId: number | null) => {
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
      // Delete physical file
      if (fs.existsSync(file.path)) {
        fs.unlinkSync(file.path);
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

  console.log('IPC handlers ready');
}
