import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../schema';
import { FolderValidation } from './FolderValidation';
import { FolderQueries } from './FolderQueries';
import { FileQueries } from './FileQueries';
import { FolderMoveOperations } from './FolderMoveOperations';

export class FolderOperations {
  private db: BetterSQLite3Database<typeof schema>;
  private validation: FolderValidation;
  private folderQueries: FolderQueries;
  private fileQueries: FileQueries;
  private folderMoveOperations: FolderMoveOperations;

  constructor(
    db: BetterSQLite3Database<typeof schema>,
    validation: FolderValidation,
    folderQueries: FolderQueries,
    fileQueries: FileQueries,
    folderMoveOperations: FolderMoveOperations
  ) {
    this.db = db;
    this.validation = validation;
    this.folderQueries = folderQueries;
    this.fileQueries = fileQueries;
    this.folderMoveOperations = folderMoveOperations;
  }

  /**
   * Creates a folder with validation
   * Enforces: No duplicate names at the same level
   * @param name - Folder name
   * @param parentId - Parent folder ID (0 for root)
   * @returns Created folder
   */
  async createFolder(name: string, parentId: number = 0): Promise<schema.Folder> {
    const trimmedName = this.validation.validateFolderName(name);

    // Check for duplicate name at this level
    await this.validation.validateNoDuplicateFolderName(trimmedName, parentId);

    const inserted = await this.db.insert(schema.folders).values({
      name: trimmedName,
      parentId,
    }).returning();

    // Expand the parent folder and all its ancestor folders to show the newly created folder
    if (parentId !== 0) {
      await this.folderQueries.expandAncestorFolders(parentId);
    }

    return inserted[0];
  }

  /**
   * Moves a folder to a new parent
   * Delegates to FolderMoveOperations
   * @param folderId - Folder ID to move
   * @param newParentId - New parent folder ID (0 for root)
   * @param forceMerge - If true, merge with existing folder of same name
   */
  async moveFolder(folderId: number, newParentId: number, forceMerge: boolean = false): Promise<void> {
    return this.folderMoveOperations.moveFolder(
      folderId,
      newParentId,
      forceMerge,
      this.removeFolder.bind(this)
    );
  }

  /**
   * Removes a folder and all descendants
   * Enforces: Cascade cleanup of file references
   * @param folderId - Folder ID to remove
   */
  async removeFolder(folderId: number): Promise<void> {
    // Rule: Cannot remove the system root folder
    if (folderId === 0) {
      throw new Error('Cannot remove the system root folder');
    }

    const folderToDelete = await this.folderQueries.getFolderById(folderId);
    if (!folderToDelete) {
      throw new Error('Folder not found');
    }

    const parentFolderId = folderToDelete.parentId;
    const folderIdsToDelete = await this.folderQueries.getAllDescendantIds(folderId);

    // Clean up file references
    await this.cleanupFileReferences(folderIdsToDelete, parentFolderId);

    // Delete folder (cascade deletes children)
    await this.db.delete(schema.folders).where(eq(schema.folders.id, folderId));
  }

  /**
   * Cleans up file references when folders are deleted
   * Moves files to parent if they lose all folder associations
   * @param folderIdsToDelete - Array of folder IDs being deleted
   * @param parentFolderId - Parent folder ID to move orphaned files to
   */
  private async cleanupFileReferences(
    folderIdsToDelete: number[],
    parentFolderId: number
  ): Promise<void> {
    const files = await this.fileQueries.getAllFiles();

    for (const file of files) {
      if (!file.folderIds) continue;

      const folderIds = this.fileQueries.parseFolderIds(file.folderIds);
      const newFolderIds = folderIds.filter(id => !folderIdsToDelete.includes(id));

      // Only update if something changed
      if (folderIds.length !== newFolderIds.length) {
        // If file loses all folders, move to parent of deleted folder
        if (newFolderIds.length === 0) {
          newFolderIds.push(parentFolderId);
        }

        await this.fileQueries.updateFileFolderIds(file.id, newFolderIds);
      }
    }
  }
}
