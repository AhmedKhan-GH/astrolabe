import { eq, and } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../schema';
import type { Folder } from '../schema';
import { ERROR_MESSAGES } from '../../config/constants';
import { logger } from '../../utils/logger';

/**
 * Folder operations - handles all folder-related business logic
 * Combines queries, validation, and operations in one place
 */
export class FolderOperations {
  private db: BetterSQLite3Database<typeof schema>;

  constructor(db: BetterSQLite3Database<typeof schema>) {
    this.db = db;
  }

  // ============ Query Methods ============

  async getFolderById(folderId: number): Promise<Folder | undefined> {
    const result = await this.db.select().from(schema.folders)
      .where(eq(schema.folders.id, folderId))
      .limit(1);
    return result[0];
  }

  async getAllFolders(): Promise<Folder[]> {
    return this.db.select().from(schema.folders);
  }

  async getAllDescendantIds(folderId: number): Promise<number[]> {
    // Check if folder exists (root folder 0 always exists)
    if (folderId !== 0) {
      const folder = await this.getFolderById(folderId);
      if (!folder) {
        throw new Error('Failed to get descendants: Folder not found');
      }
    }

    const children = await this.db.select().from(schema.folders)
      .where(eq(schema.folders.parentId, folderId));

    // If no children, return empty array
    if (children.length === 0) {
      return [];
    }

    let allIds: number[] = [];
    for (const child of children) {
      // Verify child exists before adding
      const childFolder = await this.getFolderById(child.id);
      if (childFolder) {
        allIds.push(child.id);
        const childDescendants = await this.getAllDescendantIds(child.id);
        allIds = allIds.concat(childDescendants);
      }
    }
    return allIds;
  }

  private async getChildFolders(parentId: number): Promise<Folder[]> {
    return this.db.select().from(schema.folders)
      .where(eq(schema.folders.parentId, parentId));
  }

  private async getFolderByNameAndParent(
    name: string,
    parentId: number,
    excludeFolderId?: number
  ): Promise<Folder | undefined> {
    const conditions = and(
      eq(schema.folders.name, name),
      eq(schema.folders.parentId, parentId)
    );

    const result = await this.db.select().from(schema.folders).where(conditions);

    const filtered = excludeFolderId
      ? result.filter(f => f.id !== excludeFolderId)
      : result;

    return filtered[0];
  }

  // ============ Helper Methods ============

  async getAllAncestorIds(folderId: number): Promise<number[]> {
    if (folderId === 0) return [];

    const ancestorIds: number[] = [];
    let currentId: number | null = folderId;

    while (currentId !== null && currentId !== 0) {
      const folder = await this.getFolderById(currentId);
      if (!folder) {
        // If this is the starting folder, throw error
        if (currentId === folderId) {
          throw new Error('Failed to get ancestors: Folder not found');
        }
        // Otherwise, stop traversal (broken chain)
        break;
      }

      ancestorIds.push(currentId);
      currentId = folder.parentId;
    }

    return ancestorIds;
  }

  async expandAncestorFolders(folderId: number): Promise<void> {
    if (folderId === 0) return;

    const ancestorIds = await this.getAllAncestorIds(folderId);

    for (const ancestorId of ancestorIds) {
      const folder = await this.getFolderById(ancestorId);
      if (folder && !folder.isExpanded) {
        await this.db.update(schema.folders)
          .set({ isExpanded: true })
          .where(eq(schema.folders.id, ancestorId));
      }
    }
  }

  async toggleFolderExpanded(folderId: number): Promise<void> {
    const folder = await this.getFolderById(folderId);
    if (!folder) {
      throw new Error('Failed to toggle folder: Folder not found');
    }

    await this.db.update(schema.folders)
      .set({ isExpanded: !folder.isExpanded })
      .where(eq(schema.folders.id, folderId));
  }

  async expandAllDescendants(folderId: number): Promise<void> {
    const folder = await this.getFolderById(folderId);
    if (!folder) {
      throw new Error('Failed to expand all: Folder not found');
    }

    // Expand the folder itself
    await this.db.update(schema.folders)
      .set({ isExpanded: true })
      .where(eq(schema.folders.id, folderId));

    // Get all descendants and expand them
    const descendantIds = await this.getAllDescendantIds(folderId);
    for (const descendantId of descendantIds) {
      await this.db.update(schema.folders)
        .set({ isExpanded: true })
        .where(eq(schema.folders.id, descendantId));
    }
  }

  async collapseAllDescendants(folderId: number): Promise<void> {
    const folder = await this.getFolderById(folderId);
    if (!folder) {
      throw new Error('Failed to collapse all: Folder not found');
    }

    // Get all descendants and collapse them
    const descendantIds = await this.getAllDescendantIds(folderId);
    for (const descendantId of descendantIds) {
      await this.db.update(schema.folders)
        .set({ isExpanded: false })
        .where(eq(schema.folders.id, descendantId));
    }

    // Collapse the folder itself last
    await this.db.update(schema.folders)
      .set({ isExpanded: false })
      .where(eq(schema.folders.id, folderId));
  }

  async expandAllFolders(): Promise<void> {
    // Expand all folders in the database
    const allFolders = await this.getAllFolders();
    for (const folder of allFolders) {
      await this.db.update(schema.folders)
        .set({ isExpanded: true })
        .where(eq(schema.folders.id, folder.id));
    }
  }

  async collapseAllFolders(): Promise<void> {
    // Collapse all folders in the database
    const allFolders = await this.getAllFolders();
    for (const folder of allFolders) {
      await this.db.update(schema.folders)
        .set({ isExpanded: false })
        .where(eq(schema.folders.id, folder.id));
    }
  }

  // ============ Validation Methods ============

  private validateFolderName(name: string): string {
    if (!name || !name.trim()) {
      throw new Error('Failed to create folder: Folder name cannot be empty');
    }
    return name;
  }

  private async validateNoDuplicateFolderName(
    name: string,
    parentId: number,
    excludeFolderId?: number
  ): Promise<void> {
    const siblings = await this.db.select().from(schema.folders)
      .where(eq(schema.folders.parentId, parentId));

    const duplicate = siblings.find(
      f => f.name === name && f.id !== excludeFolderId
    );

    if (duplicate) {
      throw new Error('Failed to create folder: A folder with this name already exists at this level');
    }
  }

  private async isDescendantOf(
    potentialDescendantId: number,
    ancestorId: number
  ): Promise<boolean> {
    const folder = await this.getFolderById(potentialDescendantId);
    if (!folder) return false;
    if (folder.parentId === ancestorId) return true;
    if (folder.parentId === 0) return false;
    return this.isDescendantOf(folder.parentId, ancestorId);
  }

  // ============ Business Operations ============

  async createFolder(name: string, parentId: number = 0): Promise<Folder> {
    const trimmedName = this.validateFolderName(name);
    await this.validateNoDuplicateFolderName(trimmedName, parentId);

    const inserted = await this.db.insert(schema.folders).values({
      name: trimmedName,
      parentId,
    }).returning();

    if (parentId !== 0) {
      await this.expandAncestorFolders(parentId);
    }

    return inserted[0];
  }

  async moveFolder(
    folderId: number,
    newParentId: number,
    getFolderIdsForFile: (fileId: number) => Promise<number[]>,
    removeFileFolderLink: (fileId: number, folderId: number) => Promise<void>,
    addFileFolderLink: (fileId: number, folderId: number) => Promise<void>,
    getAllFiles: () => Promise<schema.File[]>
  ): Promise<void> {
    if (folderId === 0) {
      throw new Error(ERROR_MESSAGES.CANNOT_MOVE_DIRECTORY);
    }

    if (folderId === newParentId) {
      throw new Error('Failed to move folder: Cannot move folder to itself');
    }

    const folder = await this.getFolderById(folderId);
    if (!folder) {
      throw new Error('Failed to move folder: Folder not found');
    }

    if (folder.parentId === newParentId) {
      throw new Error('Failed to move folder: Folder is already in this location');
    }

    if (newParentId !== 0) {
      if (await this.isDescendantOf(newParentId, folderId)) {
        throw new Error('Failed to move folder: Cannot move folder to its own descendant');
      }
    }

    const existingFolder = await this.getFolderByNameAndParent(folder.name, newParentId, folderId);

    if (existingFolder) {
      // Auto-merge folders when duplicate name detected
      logger.info({ sourceFolderId: folderId, targetFolderId: existingFolder.id, folderName: folder.name, mergeType: 'move-driven' }, '[FolderOperations] Merging folders due to move operation');
      await this.mergeFolders(folderId, existingFolder.id, getFolderIdsForFile, removeFileFolderLink, addFileFolderLink, getAllFiles);
      await this.db.delete(schema.folders).where(eq(schema.folders.id, folderId));
      logger.info({ sourceFolderId: folderId, targetFolderId: existingFolder.id, mergeType: 'move-driven' }, '[FolderOperations] Move-driven merge completed');
      return;
    }

    await this.db.update(schema.folders)
      .set({ parentId: newParentId })
      .where(eq(schema.folders.id, folderId));
  }

  private async mergeFolders(
    sourceFolderId: number,
    targetFolderId: number,
    getFolderIdsForFile: (fileId: number) => Promise<number[]>,
    removeFileFolderLink: (fileId: number, folderId: number) => Promise<void>,
    addFileFolderLink: (fileId: number, folderId: number) => Promise<void>,
    getAllFiles: () => Promise<schema.File[]>
  ): Promise<void> {
    // Move all direct children folders to target
    const childFolders = await this.getChildFolders(sourceFolderId);
    for (const childFolder of childFolders) {
      await this.db.update(schema.folders)
        .set({ parentId: targetFolderId })
        .where(eq(schema.folders.id, childFolder.id));
    }

    // Move all file-folder links from source to target
    const files = await getAllFiles();
    for (const file of files) {
      const folderIds = await getFolderIdsForFile(file.id);
      if (folderIds.includes(sourceFolderId)) {
        // Remove link to source folder
        await removeFileFolderLink(file.id, sourceFolderId);
        // Add link to target folder (if not already there)
        if (!folderIds.includes(targetFolderId)) {
          await addFileFolderLink(file.id, targetFolderId);
        }
      }
    }
  }

  async removeFolder(
    folderId: number,
    getFolderIdsForFile: (fileId: number) => Promise<number[]>,
    removeFileFolderLink: (fileId: number, folderId: number) => Promise<void>,
    addFileFolderLink: (fileId: number, folderId: number) => Promise<void>,
    getAllFiles: () => Promise<schema.File[]>
  ): Promise<void> {
    if (folderId === 0) {
      throw new Error(ERROR_MESSAGES.CANNOT_REMOVE_DIRECTORY);
    }

    const folderToDelete = await this.getFolderById(folderId);
    if (!folderToDelete) {
      throw new Error('Failed to remove folder: Folder not found');
    }

    const parentFolderId = folderToDelete.parentId;

    // Get direct child folders before deletion
    const childFolders = await this.getChildFolders(folderId);

    // Move child folders to parent, merging if names conflict
    for (const childFolder of childFolders) {
      const existingFolder = await this.getFolderByNameAndParent(childFolder.name, parentFolderId, childFolder.id);

      if (existingFolder) {
        // Merge the child folder into the existing folder with the same name
        logger.info({ sourceFolderId: childFolder.id, targetFolderId: existingFolder.id, folderName: childFolder.name, mergeType: 'remove-driven', removedParentId: folderId }, '[FolderOperations] Merging folders due to parent folder removal');
        await this.mergeFolders(childFolder.id, existingFolder.id, getFolderIdsForFile, removeFileFolderLink, addFileFolderLink, getAllFiles);
        await this.db.delete(schema.folders).where(eq(schema.folders.id, childFolder.id));
        logger.info({ sourceFolderId: childFolder.id, targetFolderId: existingFolder.id, mergeType: 'remove-driven' }, '[FolderOperations] Remove-driven merge completed');
      } else {
        // No conflict, just move the folder up
        await this.db.update(schema.folders)
          .set({ parentId: parentFolderId })
          .where(eq(schema.folders.id, childFolder.id));
      }
    }

    const descendantIds = await this.getAllDescendantIds(folderId);
    const folderIdsToDelete = [folderId, ...descendantIds];

    // Clean up file-folder links
    const files = await getAllFiles();
    for (const file of files) {
      const folderIds = await getFolderIdsForFile(file.id);
      const hasDeletedFolder = folderIds.some(id => folderIdsToDelete.includes(id));

      if (hasDeletedFolder) {
        // Remove links to deleted folders
        for (const fId of folderIdsToDelete) {
          if (folderIds.includes(fId)) {
            await removeFileFolderLink(file.id, fId);
          }
        }

        // If file has no remaining folders, add it to parent
        const remainingFolderIds = folderIds.filter(id => !folderIdsToDelete.includes(id));
        if (remainingFolderIds.length === 0) {
          await addFileFolderLink(file.id, parentFolderId);
        }
      }
    }

    await this.db.delete(schema.folders).where(eq(schema.folders.id, folderId));
  }

  async deleteFolder(
    folderId: number,
    getFolderIdsForFile: (fileId: number) => Promise<number[]>,
    deleteFile: (fileId: number) => Promise<void>,
    removeFileFolderLink: (fileId: number, folderId: number) => Promise<void>,
    getAllFiles: () => Promise<schema.File[]>
  ): Promise<void> {
    if (folderId === 0) {
      throw new Error(ERROR_MESSAGES.CANNOT_REMOVE_DIRECTORY);
    }

    const folderToDelete = await this.getFolderById(folderId);
    if (!folderToDelete) {
      throw new Error('Failed to delete folder: Folder not found');
    }

    // Get ALL descendant folder IDs BEFORE any modifications
    const descendantIds = await this.getAllDescendantIds(folderId);
    const folderIdsToDelete = [folderId, ...descendantIds];
    logger.info({ folderId, folderIdsToDelete }, '[FolderOperations] Cascade deleting folder and all descendants');

    // Handle file cleanup
    const files = await getAllFiles();
    for (const file of files) {
      const folderIds = await getFolderIdsForFile(file.id);
      const hasDeletedFolder = folderIds.some(id => folderIdsToDelete.includes(id));

      if (!hasDeletedFolder) continue;

      // Remove deleted folder IDs from file's folder list
      const remainingFolderIds = folderIds.filter(id => !folderIdsToDelete.includes(id));

      if (remainingFolderIds.length === 0) {
        // File is ONLY in folders being deleted - delete the file completely
        logger.info({ fileId: file.id, filename: file.filename }, '[FolderOperations] Deleting file (unique to deleted folders)');
        await deleteFile(file.id);
      } else {
        // File exists in other folders - just remove the links to deleted folders
        for (const fId of folderIdsToDelete) {
          if (folderIds.includes(fId)) {
            await removeFileFolderLink(file.id, fId);
          }
        }
      }
    }

    // Delete all folders (including descendants)
    for (const deleteFolderId of folderIdsToDelete) {
      await this.db.delete(schema.folders).where(eq(schema.folders.id, deleteFolderId));
    }

    logger.info({ folderId, deletedCount: folderIdsToDelete.length }, '[FolderOperations] Cascade delete completed');
  }
}
