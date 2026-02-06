import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../schema';
import { FolderValidation } from './FolderValidation';
import { FolderQueries } from './FolderQueries';
import { FileQueries } from './FileQueries';

/**
 * Handles folder move operations in the file tree
 */
export class FolderMoveOperations {
  private db: BetterSQLite3Database<typeof schema>;
  private folderValidation: FolderValidation;
  private folderQueries: FolderQueries;
  private fileQueries: FileQueries;

  constructor(
    db: BetterSQLite3Database<typeof schema>,
    folderValidation: FolderValidation,
    folderQueries: FolderQueries,
    fileQueries: FileQueries
  ) {
    this.db = db;
    this.folderValidation = folderValidation;
    this.folderQueries = folderQueries;
    this.fileQueries = fileQueries;
  }

  /**
   * Moves a folder to a new parent
   * Enforces: No self-reference, no circular ancestry, no duplicate names
   * @param folderId - Folder ID to move
   * @param newParentId - New parent folder ID (0 for root)
   * @param forceMerge - If true, merge with existing folder of same name
   * @param removeFolderCallback - Callback to remove folder after merge (to avoid circular dependency)
   */
  async moveFolder(
    folderId: number,
    newParentId: number,
    forceMerge: boolean = false,
    removeFolderCallback?: (folderId: number) => Promise<void>
  ): Promise<void> {
    // Rule: Cannot move the system root folder
    if (folderId === 0) {
      throw new Error('Cannot move the system root folder');
    }

    // Rule: Cannot move folder to itself
    this.folderValidation.validateFolderMove(folderId, newParentId);

    // Get folder to check current location and name collision
    const folder = await this.folderQueries.getFolderById(folderId);
    if (!folder) {
      throw new Error('Folder not found');
    }

    // Rule: Cannot move folder to the same location
    if (folder.parentId === newParentId) {
      throw new Error('Folder is already in this location');
    }

    // Rule: Cannot move folder to its own descendant
    if (newParentId !== 0) {
      if (await this.folderValidation.isDescendantOf(newParentId, folderId, this.folderQueries.getFolderById.bind(this.folderQueries))) {
        throw new Error('Cannot move folder to its own descendant');
      }
    }

    // Check for duplicate names at destination level
    const existingFolder = await this.folderQueries.getFolderByNameAndParent(folder.name, newParentId, folderId);

    if (existingFolder) {
      if (!forceMerge) {
        // Throw special error that UI can catch to prompt for merge
        throw new Error('DUPLICATE_FOLDER_NAME');
      }

      // Merge: move all children of source folder to existing folder
      await this.mergeFolders(folderId, existingFolder.id);

      // Delete the source folder after merge
      if (removeFolderCallback) {
        await removeFolderCallback(folderId);
      } else {
        // Fallback: direct deletion (used when callback not available)
        await this.db.delete(schema.folders).where(eq(schema.folders.id, folderId));
      }
      return;
    }

    await this.db.update(schema.folders)
      .set({ parentId: newParentId })
      .where(eq(schema.folders.id, folderId));
  }

  /**
   * Merges source folder contents into target folder
   * @param sourceFolderId - Folder to merge from
   * @param targetFolderId - Folder to merge into
   */
  private async mergeFolders(sourceFolderId: number, targetFolderId: number): Promise<void> {
    // Move all direct children folders to target
    const childFolders = await this.folderQueries.getChildFolders(sourceFolderId);
    for (const childFolder of childFolders) {
      await this.db.update(schema.folders)
        .set({ parentId: targetFolderId })
        .where(eq(schema.folders.id, childFolder.id));
    }

    // Move all files to target folder
    const files = await this.fileQueries.getAllFiles();
    for (const file of files) {
      if (!file.folderIds) continue;

      const folderIds = this.fileQueries.parseFolderIds(file.folderIds);
      if (folderIds.includes(sourceFolderId)) {
        // Replace source folder with target folder in file's folder list
        const newFolderIds = folderIds.map(id => id === sourceFolderId ? targetFolderId : id);
        // Remove duplicates
        const uniqueFolderIds = Array.from(new Set(newFolderIds));
        await this.fileQueries.updateFileFolderIds(file.id, uniqueFolderIds);
      }
    }
  }
}
