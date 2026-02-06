import { FolderQueries } from './FolderQueries';
import { FileQueries } from './FileQueries';

/**
 * Handles file move operations in the file tree
 */
export class FileMoveOperations {
  private folderQueries: FolderQueries;
  private fileQueries: FileQueries;

  constructor(
    folderQueries: FolderQueries,
    fileQueries: FileQueries
  ) {
    this.folderQueries = folderQueries;
    this.fileQueries = fileQueries;
  }

  /**
   * Moves a file to a folder (replaces all folder associations)
   * Enforces: Valid folder reference
   * @param fileId - File ID to move
   * @param folderId - Target folder ID (0 for root)
   */
  async moveFile(fileId: number, folderId: number): Promise<void> {
      const folder = await this.folderQueries.getFolderById(folderId);
      if (!folder) {
        throw new Error('Target folder not found');
      }

    const file = await this.fileQueries.getFileById(fileId);
    if (!file) {
      throw new Error('File not found');
    }

    // Check if file is already in this location
    const currentFolderIds = this.fileQueries.parseFolderIds(file.folderIds);
    const newFolderIds = [folderId];

    const currentSet = new Set(currentFolderIds);
    const newSet = new Set(newFolderIds);

    if ([...currentSet].every(id => newSet.has(id)) &&
        [...newSet].every(id => currentSet.has(id))) {
      throw new Error('File is already in this location');
    }

    await this.fileQueries.updateFileFolderIds(fileId, newFolderIds);

    // Expand the target folder and all ancestor folders to show the moved file
    if (folderId !== 0) {
      await this.folderQueries.expandAncestorFolders(folderId);
    }
  }
}
