import { ipcMain } from 'electron';
import { getDatabase } from '../database';
import { getDataDirectory } from '../settings';
import { ServiceFactory } from '../../src/services/ServiceFactory';
import { logger } from '../utils/logger';

/**
 * Sets up IPC handlers for folder processes
 */
export function setupFolderProcessHandlers() {
  // Remove existing handlers first to prevent duplicates
  const handlers = [
    'getAllFolders',
    'createFolder',
    'moveFile',
    'addFile',
    'moveFolder',
    'removeFileFromFolder',
    'removeFolder',
    'deleteFolder',
    'toggleFolderExpanded',
    'expandAllDescendants',
    'collapseAllDescendants',
    'expandAllFolders',
    'collapseAllFolders',
    'addFolder'
  ];

  handlers.forEach(handler => ipcMain.removeHandler(handler));

  // Helpers to get fresh service instances
  const getServices = () => {
    const db = getDatabase();
    const dataDir = getDataDirectory();
    const config = ServiceFactory.createConfigFromEnv(db, dataDir);
    return {
      folderService: ServiceFactory.getFolderService(config),
      fileService: ServiceFactory.getFileService(config)
    };
  };

  ipcMain.handle('getAllFolders', async () => {
    const { folderService } = getServices();
    return folderService.getAllFolders();
  });

  ipcMain.handle('createFolder', async (_, name: string, parentId?: number) => {
    const { folderService } = getServices();
    logger.info({ name, parentId }, '[IPC] createFolder called');
    const inserted = await folderService.createFolder(name, parentId);
    logger.info({ folder: inserted }, '[IPC] Folder created successfully');
    return inserted;
  });

  ipcMain.handle('moveFile', async (_, fileId: number, folderId: number) => {
    const { fileService } = getServices();
    logger.info({ fileId, folderId }, '[IPC] moveFile called');
    await fileService.moveFile(fileId, folderId);
    logger.info({ fileId, folderId }, '[IPC] File moved successfully');
  });

  ipcMain.handle('addFile', async (_, fileId: number, folderId: number) => {
    const { fileService } = getServices();
    logger.info({ fileId, folderId }, '[IPC] addFile called');
    await fileService.addFile(fileId, folderId);
    logger.info({ fileId, folderId }, '[IPC] File added successfully');
  });

  ipcMain.handle('moveFolder', async (_, folderId: number, newParentId: number) => {
    const { folderService } = getServices();
    logger.info({ folderId, newParentId }, '[IPC] moveFolder called');
    const result = await folderService.moveFolder(folderId, newParentId);
    logger.info({ result }, '[IPC] Folder moved');
    return result;
  });

  ipcMain.handle('removeFileFromFolder', async (_, fileId: number, folderId: number) => {
    const { fileService } = getServices();
    logger.info({ fileId, folderId }, '[IPC] removeFileFromFolder called');
    await fileService.removeFileFromFolder(fileId, folderId);
    logger.info({ fileId, folderId }, '[IPC] File removed from folder successfully');
  });

  ipcMain.handle('removeFolder', async (_, folderId: number) => {
    const { folderService } = getServices();
    logger.info({ folderId }, '[IPC] removeFolder called');
    await folderService.removeFolder(folderId);
    logger.info({ folderId }, '[IPC] Folder removed successfully');
  });

  ipcMain.handle('deleteFolder', async (_, folderId: number) => {
    const { folderService } = getServices();
    logger.info({ folderId }, '[IPC] deleteFolder called - cascade delete');
    await folderService.deleteFolder(folderId);
    logger.info({ folderId }, '[IPC] Folder cascade deleted successfully');
  });

  ipcMain.handle('toggleFolderExpanded', async (_, folderId: number) => {
    const { folderService } = getServices();
    await folderService.toggleFolderExpanded(folderId);
  });

  ipcMain.handle('expandAllDescendants', async (_, folderId: number) => {
    const { folderService } = getServices();
    logger.info({ folderId }, '[IPC] expandAllDescendants called');
    await folderService.expandAllDescendants(folderId);
    logger.info({ folderId }, '[IPC] Expanded all descendants successfully');
  });

  ipcMain.handle('collapseAllDescendants', async (_, folderId: number) => {
    const { folderService } = getServices();
    logger.info({ folderId }, '[IPC] collapseAllDescendants called');
    await folderService.collapseAllDescendants(folderId);
    logger.info({ folderId }, '[IPC] Collapsed all descendants successfully');
  });

  ipcMain.handle('expandAllFolders', async () => {
    const { folderService } = getServices();
    logger.info('[IPC] expandAllFolders called');
    await folderService.expandAllFolders();
    logger.info('[IPC] Expanded all folders successfully');
  });

  ipcMain.handle('collapseAllFolders', async () => {
    const { folderService } = getServices();
    logger.info('[IPC] collapseAllFolders called');
    await folderService.collapseAllFolders();
    logger.info('[IPC] Collapsed all folders successfully');
  });

  ipcMain.handle('addFolder', async (_, sourceFolderId: number, targetParentId: number) => {
    const { folderService } = getServices();
    logger.info({ sourceFolderId, targetParentId }, '[IPC] addFolder called');
    const newFolder = await folderService.addFolder(sourceFolderId, targetParentId);
    logger.info({ sourceFolderId, targetParentId, newFolderId: newFolder.id }, '[IPC] Folder added successfully');
    return newFolder;
  });
}
