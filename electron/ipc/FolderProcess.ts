import { ipcMain } from 'electron';
import { getDatabase } from '../database';
import { getDataDirectory } from '../settings';
import { LocalFolderService } from '../../src/services/LocalFolderService';
import { LocalFileService } from '../../src/services/LocalFileService';

/**
 * Sets up IPC handlers for folder processes
 */
export function setupFolderProcessHandlers() {
  ipcMain.handle('getAllFolders', async () => {
    const db = getDatabase();
    const folderService = new LocalFolderService(db);
    return folderService.getAllFolders();
  });

  ipcMain.handle('createFolder', async (_, name: string, parentId?: number) => {
    console.log('createFolder called with name:', name, 'parentId:', parentId);
    const db = getDatabase();
    const folderService = new LocalFolderService(db);

    const inserted = await folderService.createFolder(name, parentId);
    console.log('Folder created:', inserted);
    return inserted;
  });

  ipcMain.handle('moveFile', async (_, fileId: number, folderId: number) => {
    console.log('moveFile called:', { fileId, folderId });
    const db = getDatabase();
    const dataDir = getDataDirectory();
    const fileService = new LocalFileService(db, dataDir);

    await fileService.moveFile(fileId, folderId);
    console.log('File moved');
  });

  ipcMain.handle('includeFileInFolder', async (_, fileId: number, folderId: number) => {
    console.log('includeFileInFolder called:', { fileId, folderId });
    const db = getDatabase();
    const dataDir = getDataDirectory();
    const fileService = new LocalFileService(db, dataDir);

    await fileService.addFileToFolder(fileId, folderId);
    console.log('File added to folder');
  });

  ipcMain.handle('moveFolder', async (_, folderId: number, newParentId: number, forceMerge?: boolean) => {
    console.log('moveFolder called:', { folderId, newParentId, forceMerge });
    const db = getDatabase();
    const folderService = new LocalFolderService(db);

    const result = await folderService.moveFolder(folderId, newParentId, forceMerge);
    console.log('Folder moved:', result);
    return result;
  });

  ipcMain.handle('removeFileFromFolder', async (_, fileId: number, folderId: number) => {
    console.log('removeFileFromFolder called:', { fileId, folderId });
    const db = getDatabase();
    const dataDir = getDataDirectory();
    const fileService = new LocalFileService(db, dataDir);

    await fileService.removeFileFromFolder(fileId, folderId);
    console.log('File removed from folder');
  });

  ipcMain.handle('removeFolder', async (_, folderId: number) => {
    console.log('removeFolder called:', folderId);
    const db = getDatabase();
    const folderService = new LocalFolderService(db);

    await folderService.removeFolder(folderId);
    console.log('Folder removed successfully');
  });

  ipcMain.handle('toggleFolderExpanded', async (_, folderId: number) => {
    const db = getDatabase();
    const folderService = new LocalFolderService(db);
    await folderService.toggleFolderExpanded(folderId);
  });
}
