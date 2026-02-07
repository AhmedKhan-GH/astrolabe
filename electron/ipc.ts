import { setupFileProcessHandlers } from './ipc/FileProcess';
import { setupFolderProcessHandlers } from './ipc/FolderProcess';
import { setupDatabaseProcessHandlers } from './ipc/DatabaseProcess';

export function setupIpcHandlers() {
  setupFileProcessHandlers();
  setupFolderProcessHandlers();
  setupDatabaseProcessHandlers();

  console.log('IPC handlers ready');
}
