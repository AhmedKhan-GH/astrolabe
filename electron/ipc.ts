import { setupFileProcessHandlers } from './ipc/FileProcess';
import { setupFolderProcessHandlers } from './ipc/FolderProcess';
import { setupDatabaseProcessHandlers } from './ipc/DatabaseProcess';
import { logger } from './utils/logger';

export function setupIpcHandlers() {
  logger.info('Registering IPC handlers...');

  logger.debug('Setting up file process handlers');
  setupFileProcessHandlers();

  logger.debug('Setting up folder process handlers');
  setupFolderProcessHandlers();

  logger.debug('Setting up database process handlers');
  setupDatabaseProcessHandlers();

  logger.info('All IPC handlers registered successfully');
}
