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

      try {
        // Use importFile to handle duplicates with user confirmation
        // folderId = 0 means root, folderId > 0 means specific folder
        const result = await fileOps.importFile(
          filename,
          storedPath,
          ext ? ext.slice(1) : null,
          folderId !== undefined ? folderId : 0,
          async (existingFile) => {
            // Show confirmation dialog to user
            const response = await dialog.showMessageBox({
              type: 'question',
              buttons: ['Cancel', 'Update'],
              defaultId: 1,
              title: 'File Already Exists',
              message: `File "${filename}" already exists in the database.`,
              detail: 'Do you want to update the existing file entry and add it to this location?'
            });
            return response.response === 1; // 1 = Update button
          }
        );

        uploadedFiles.push(result.file);
      } catch (error) {
        // Show error dialog to user
        await dialog.showMessageBox({
          type: 'error',
          buttons: ['OK'],
          title: 'Import Failed',
          message: `Failed to import "${filename}"`,
          detail: error instanceof Error ? error.message : String(error)
        });

        // Clean up the copied file since import failed
        if (fs.existsSync(storedPath)) {
          fs.unlinkSync(storedPath);
        }
      }
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

    // Convert parentId = 0 (root) to null for database operations
    const inserted = await fileOps.createFolder(name, !parentId || parentId === 0 ? null : parentId);
    console.log('Folder created:', inserted);
    return inserted;
  });

  ipcMain.handle('moveFile', async (_, fileId: number, folderId: number) => {
    console.log('moveFile called:', { fileId, folderId });
    const db = getDatabase();
    const fileOps = new FileTreeOperations(db);

    // Convert folderId = 0 (root) to null for database operations
    await fileOps.moveFile(fileId, folderId === 0 ? null : folderId);
    console.log('File moved');
  });

  ipcMain.handle('includeFileInFolder', async (_, fileId: number, folderId: number) => {
    console.log('includeFileInFolder called:', { fileId, folderId });
    const db = getDatabase();
    const fileOps = new FileTreeOperations(db);

    await fileOps.addFileToFolder(fileId, folderId);
    console.log('File added to folder');
  });

  ipcMain.handle('moveFolder', async (_, folderId: number, newParentId: number) => {
    console.log('moveFolder called:', { folderId, newParentId });
    const db = getDatabase();
    const fileOps = new FileTreeOperations(db);

    // Convert newParentId = 0 (root) to null for database operations
    await fileOps.moveFolder(folderId, newParentId === 0 ? null : newParentId);
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
