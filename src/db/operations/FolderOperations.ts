import { eq, and } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../schema';
import type { Folder } from '../schema';

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
    const children = await this.db.select().from(schema.folders)
      .where(eq(schema.folders.parentId, folderId));

    let allIds: number[] = [folderId];
    for (const child of children) {
      const childIds = await this.getAllDescendantIds(child.id);
      allIds = allIds.concat(childIds);
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

  async expandAncestorFolders(folderId: number): Promise<void> {
    if (folderId === 0) return;

    let currentId: number | null = folderId;
    while (currentId !== null && currentId !== 0) {
      const folder = await this.getFolderById(currentId);
      if (!folder) break;

      if (!folder.isExpanded) {
        await this.db.update(schema.folders)
          .set({ isExpanded: true })
          .where(eq(schema.folders.id, currentId));
      }

      currentId = folder.parentId;
    }
  }

  async toggleFolderExpanded(folderId: number): Promise<void> {
    const folder = await this.getFolderById(folderId);
    if (!folder) {
      throw new Error('Folder not found');
    }

    await this.db.update(schema.folders)
      .set({ isExpanded: !folder.isExpanded })
      .where(eq(schema.folders.id, folderId));
  }

  // ============ Validation Methods ============

  private validateFolderName(name: string): string {
    const trimmedName = name.trim();
    if (!trimmedName) {
      throw new Error('Folder name cannot be empty');
    }
    return trimmedName;
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
      throw new Error('A folder with this name already exists at this level');
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
    forceMerge: boolean = false,
    parseFolderIds: (json: string | null) => number[],
    updateFileFolderIds: (fileId: number, folderIds: number[]) => Promise<void>,
    getAllFiles: () => Promise<schema.File[]>
  ): Promise<void> {
    if (folderId === 0) {
      throw new Error('Cannot move the system root folder');
    }

    if (folderId === newParentId) {
      throw new Error('Cannot move folder to itself');
    }

    const folder = await this.getFolderById(folderId);
    if (!folder) {
      throw new Error('Folder not found');
    }

    if (folder.parentId === newParentId) {
      throw new Error('Folder is already in this location');
    }

    if (newParentId !== 0) {
      if (await this.isDescendantOf(newParentId, folderId)) {
        throw new Error('Cannot move folder to its own descendant');
      }
    }

    const existingFolder = await this.getFolderByNameAndParent(folder.name, newParentId, folderId);

    if (existingFolder) {
      if (!forceMerge) {
        throw new Error('DUPLICATE_FOLDER_NAME');
      }

      // Merge folders
      await this.mergeFolders(folderId, existingFolder.id, parseFolderIds, updateFileFolderIds, getAllFiles);
      await this.db.delete(schema.folders).where(eq(schema.folders.id, folderId));
      return;
    }

    await this.db.update(schema.folders)
      .set({ parentId: newParentId })
      .where(eq(schema.folders.id, folderId));
  }

  private async mergeFolders(
    sourceFolderId: number,
    targetFolderId: number,
    parseFolderIds: (json: string | null) => number[],
    updateFileFolderIds: (fileId: number, folderIds: number[]) => Promise<void>,
    getAllFiles: () => Promise<schema.File[]>
  ): Promise<void> {
    // Move all direct children folders to target
    const childFolders = await this.getChildFolders(sourceFolderId);
    for (const childFolder of childFolders) {
      await this.db.update(schema.folders)
        .set({ parentId: targetFolderId })
        .where(eq(schema.folders.id, childFolder.id));
    }

    // Move all files to target folder
    const files = await getAllFiles();
    for (const file of files) {
      if (!file.folderIds) continue;

      const folderIds = parseFolderIds(file.folderIds);
      if (folderIds.includes(sourceFolderId)) {
        const newFolderIds = folderIds.map(id => id === sourceFolderId ? targetFolderId : id);
        const uniqueFolderIds = Array.from(new Set(newFolderIds));
        await updateFileFolderIds(file.id, uniqueFolderIds);
      }
    }
  }

  async removeFolder(
    folderId: number,
    parseFolderIds: (json: string | null) => number[],
    updateFileFolderIds: (fileId: number, folderIds: number[]) => Promise<void>,
    getAllFiles: () => Promise<schema.File[]>
  ): Promise<void> {
    if (folderId === 0) {
      throw new Error('Cannot remove the system root folder');
    }

    const folderToDelete = await this.getFolderById(folderId);
    if (!folderToDelete) {
      throw new Error('Folder not found');
    }

    const parentFolderId = folderToDelete.parentId;

    // Get direct child folders before deletion
    const childFolders = await this.getChildFolders(folderId);

    // Move child folders to parent, merging if names conflict
    for (const childFolder of childFolders) {
      const existingFolder = await this.getFolderByNameAndParent(childFolder.name, parentFolderId, childFolder.id);

      if (existingFolder) {
        // Merge the child folder into the existing folder with the same name
        await this.mergeFolders(childFolder.id, existingFolder.id, parseFolderIds, updateFileFolderIds, getAllFiles);
        await this.db.delete(schema.folders).where(eq(schema.folders.id, childFolder.id));
      } else {
        // No conflict, just move the folder up
        await this.db.update(schema.folders)
          .set({ parentId: parentFolderId })
          .where(eq(schema.folders.id, childFolder.id));
      }
    }

    const folderIdsToDelete = await this.getAllDescendantIds(folderId);

    // Clean up file references
    const files = await getAllFiles();
    for (const file of files) {
      if (!file.folderIds) continue;

      const folderIds = parseFolderIds(file.folderIds);
      const newFolderIds = folderIds.filter(id => !folderIdsToDelete.includes(id));

      if (folderIds.length !== newFolderIds.length) {
        if (newFolderIds.length === 0) {
          newFolderIds.push(parentFolderId);
        }
        await updateFileFolderIds(file.id, newFolderIds);
      }
    }

    await this.db.delete(schema.folders).where(eq(schema.folders.id, folderId));
  }
}
