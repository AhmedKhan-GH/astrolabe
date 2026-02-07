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
    'includeFileInFolder',
    'moveFolder',
    'removeFileFromFolder',
    'removeFolder',
    'toggleFolderExpanded'
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

  ipcMain.handle('includeFileInFolder', async (_, fileId: number, folderId: number) => {
    const { fileService } = getServices();
    logger.info({ fileId, folderId }, '[IPC] includeFileInFolder called');
    await fileService.addFileToFolder(fileId, folderId);
    logger.info({ fileId, folderId }, '[IPC] File added to folder successfully');
  });

  ipcMain.handle('moveFolder', async (_, folderId: number, newParentId: number, forceMerge?: boolean) => {
    const { folderService } = getServices();
    logger.info({ folderId, newParentId, forceMerge }, '[IPC] moveFolder called');
    const result = await folderService.moveFolder(folderId, newParentId, forceMerge);
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

  ipcMain.handle('toggleFolderExpanded', async (_, folderId: number) => {
    const { folderService } = getServices();
    await folderService.toggleFolderExpanded(folderId);
  });
}
