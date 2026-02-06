import { ipcMain, dialog } from 'electron';
import { getDatabase } from '../database';
import { FileTreeOperations } from '../../src/db/file-tree-operations/FileTreeOperations';
import { FileService } from '../../src/services/FileService';

/**
 * Sets up IPC handlers for folder operations
 */
export function setupFolderHandlers() {
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
    const fileService = new FileService(db);

    await fileService.moveFile(fileId, folderId);
    console.log('File moved');
  });

  ipcMain.handle('includeFileInFolder', async (_, fileId: number, folderId: number) => {
    console.log('includeFileInFolder called:', { fileId, folderId });
    const db = getDatabase();
    const fileOps = new FileTreeOperations(db);

    await fileOps.addFileToFolder(fileId, folderId);
    console.log('File added to folder');
  });

  ipcMain.handle('moveFolder', async (_, folderId: number, newParentId: number, forceMerge?: boolean) => {
    console.log('moveFolder called:', { folderId, newParentId, forceMerge });
    const db = getDatabase();
    const fileOps = new FileTreeOperations(db);

    try {
      await fileOps.moveFolder(folderId, newParentId, forceMerge);
      console.log('Folder moved');
      return { success: true };
    } catch (error) {
      console.error('moveFolder error:', error);
      if (error instanceof Error && error.message === 'DUPLICATE_FOLDER_NAME') {
        return { success: false, errorCode: 'DUPLICATE_FOLDER_NAME' };
      }
      throw error;
    }
  });

  ipcMain.handle('removeFileFromFolder', async (_, fileId: number, folderId: number) => {
    console.log('removeFileFromFolder called:', { fileId, folderId });
    const db = getDatabase();
    const fileOps = new FileTreeOperations(db);

    await fileOps.removeFileFromFolder(fileId, folderId);
    console.log('File removed from folder');
  });

  ipcMain.handle('removeFolder', async (_, folderId: number) => {
    console.log('removeFolder called:', folderId);
    const db = getDatabase();
    const fileOps = new FileTreeOperations(db);

    await fileOps.removeFolder(folderId);
    console.log('Folder removed successfully');
  });

  ipcMain.handle('toggleFolderExpanded', async (_, folderId: number) => {
    const db = getDatabase();
    const fileOps = new FileTreeOperations(db);
    await fileOps.toggleFolderExpanded(folderId);
  });
}
