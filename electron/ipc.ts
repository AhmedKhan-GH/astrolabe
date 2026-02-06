import { setupFileHandlers } from './ipc/fileOperations';
import { setupFolderHandlers } from './ipc/folderOperations';
import { setupDatabaseHandlers } from './ipc/databaseOperations';

export function setupIpcHandlers() {
  setupFileHandlers();
  setupFolderHandlers();
  setupDatabaseHandlers();

  console.log('IPC handlers ready');
}
