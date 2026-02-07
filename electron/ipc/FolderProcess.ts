import { ipcMain } from 'electron';
import { getDatabase } from '../database';
import { getDataDirectory } from '../settings';
import { ServiceFactory } from '../../src/services/ServiceFactory';

/**
 * Sets up IPC handlers for folder processes
 */
export function setupFolderProcessHandlers() {
  // Remove existing handlers first to prevent duplicates
  const handlers = [
    'getAllFolders',
    'createFolder',
    'moveFile',
    'includeFileInFolder',
    'moveFolder',
    'removeFileFromFolder',
    'removeFolder',
    'toggleFolderExpanded'
  ];

  handlers.forEach(handler => ipcMain.removeHandler(handler));

  // Create service instances once for all handlers
  const db = getDatabase();
  const dataDir = getDataDirectory();
  const config = ServiceFactory.createConfigFromEnv(db, dataDir);
  const folderService = ServiceFactory.createFolderService(config);
  const fileService = ServiceFactory.createFileService(config);

  ipcMain.handle('getAllFolders', async () => {
    return folderService.getAllFolders();
  });

  ipcMain.handle('createFolder', async (_, name: string, parentId?: number) => {
    console.log('createFolder called with name:', name, 'parentId:', parentId);
    const inserted = await folderService.createFolder(name, parentId);
    console.log('Folder created:', inserted);
    return inserted;
  });

  ipcMain.handle('moveFile', async (_, fileId: number, folderId: number) => {
    console.log('moveFile called:', { fileId, folderId });
    await fileService.moveFile(fileId, folderId);
    console.log('File moved');
  });

  ipcMain.handle('includeFileInFolder', async (_, fileId: number, folderId: number) => {
    console.log('includeFileInFolder called:', { fileId, folderId });
    await fileService.addFileToFolder(fileId, folderId);
    console.log('File added to folder');
  });

  ipcMain.handle('moveFolder', async (_, folderId: number, newParentId: number, forceMerge?: boolean) => {
    console.log('moveFolder called:', { folderId, newParentId, forceMerge });
    const result = await folderService.moveFolder(folderId, newParentId, forceMerge);
    console.log('Folder moved:', result);
    return result;
  });

  ipcMain.handle('removeFileFromFolder', async (_, fileId: number, folderId: number) => {
    console.log('removeFileFromFolder called:', { fileId, folderId });
    await fileService.removeFileFromFolder(fileId, folderId);
    console.log('File removed from folder');
  });

  ipcMain.handle('removeFolder', async (_, folderId: number) => {
    console.log('removeFolder called:', folderId);
    await folderService.removeFolder(folderId);
    console.log('Folder removed successfully');
  });

  ipcMain.handle('toggleFolderExpanded', async (_, folderId: number) => {
    await folderService.toggleFolderExpanded(folderId);
  });
}
