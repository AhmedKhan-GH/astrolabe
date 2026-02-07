import { ipcMain, dialog } from 'electron';
import { getDatabase } from '../database';
import { getDataDirectory } from '../settings';
import { LocalFileService } from '../../src/services/LocalFileService';
import * as schema from '../../src/db/schema';
import path from 'path';

/**
 * Constructs full file path from hash and filename
 * Structure: data/files/{hash}/{filename}
 */
export function getFilePathFromHash(hash: string, filename: string): string {
  const dataDir = getDataDirectory();
  const filesDir = path.join(dataDir, 'files');
  return path.join(filesDir, hash, filename);
}

/**
 * Creates a confirmation callback for file import/reference operations
 */
function createConfirmCallback(filename: string) {
  return async (existingFile: schema.File) => {
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
  };
}

/**
 * Shows error dialog to user
 */
async function showErrorDialog(title: string, message: string, detail: string) {
  await dialog.showMessageBox({
    type: 'error',
    buttons: ['OK'],
    title,
    message,
    detail
  });
}

/**
 * Sets up IPC handlers for file process communication
 */
export function setupFileProcessHandlers() {
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

    const db = getDatabase();
    const dataDir = getDataDirectory();
    const fileService = new LocalFileService(db, dataDir);

    const importedFiles = [];
    for (const filePath of result.filePaths) {
      const filename = path.basename(filePath);
      try {
        const files = await fileService.importFiles(
          [filePath],
          undefined,
          createConfirmCallback(filename)
        );
        importedFiles.push(...files);
      } catch (error) {
        await showErrorDialog(
          'Import Failed',
          `Failed to import "${filename}"`,
          error instanceof Error ? error.message : String(error)
        );
      }
    }

    return importedFiles;
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

    const db = getDatabase();
    const dataDir = getDataDirectory();
    const fileService = new LocalFileService(db, dataDir);

    const importedFiles = [];
    for (const filePath of result.filePaths) {
      const filename = path.basename(filePath);
      try {
        const files = await fileService.importFiles(
          [filePath],
          folderId,
          createConfirmCallback(filename)
        );
        importedFiles.push(...files);
      } catch (error) {
        await showErrorDialog(
          'Import Failed',
          `Failed to import "${filename}"`,
          error instanceof Error ? error.message : String(error)
        );
      }
    }

    return importedFiles;
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

    const db = getDatabase();
    const dataDir = getDataDirectory();
    const fileService = new LocalFileService(db, dataDir);

    const referencedFiles = [];
    for (const filePath of result.filePaths) {
      const filename = path.basename(filePath);
      try {
        const files = await fileService.referenceFiles(
          [filePath],
          undefined,
          createConfirmCallback(filename)
        );
        referencedFiles.push(...files);
      } catch (error) {
        await showErrorDialog(
          'Reference Failed',
          `Failed to reference "${filename}"`,
          error instanceof Error ? error.message : String(error)
        );
      }
    }

    return referencedFiles;
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

    const db = getDatabase();
    const dataDir = getDataDirectory();
    const fileService = new LocalFileService(db, dataDir);

    const referencedFiles = [];
    for (const filePath of result.filePaths) {
      const filename = path.basename(filePath);
      try {
        const files = await fileService.referenceFiles(
          [filePath],
          folderId,
          createConfirmCallback(filename)
        );
        referencedFiles.push(...files);
      } catch (error) {
        await showErrorDialog(
          'Reference Failed',
          `Failed to reference "${filename}"`,
          error instanceof Error ? error.message : String(error)
        );
      }
    }

    return referencedFiles;
  });

  ipcMain.handle('getAllFiles', async () => {
    const db = getDatabase();
    const dataDir = getDataDirectory();
    const fileService = new LocalFileService(db, dataDir);
    return fileService.getAllFiles();
  });

  ipcMain.handle('deleteFile', async (_, fileId: number) => {
    console.log('deleteFile called:', fileId);
    const db = getDatabase();
    const dataDir = getDataDirectory();
    const fileService = new LocalFileService(db, dataDir);

    await fileService.deleteFile(fileId);
    console.log('File deleted');
  });
}
