import { eq, isNull } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';

/**
 * Enforces file tree structural constraints at the data layer
 * All file and folder operations must go through this class
 */
export class FileTreeOperations {
  private db: BetterSQLite3Database<typeof schema>;

  constructor(db: BetterSQLite3Database<typeof schema>) {
    this.db = db;
  }

  // ============ Folder Operations ============

  /**
   * Creates a folder with validation
   * Enforces: No duplicate names at the same level
   */
  async createFolder(name: string, parentId: number | null = null): Promise<schema.Folder> {
    const trimmedName = name.trim();
    if (!trimmedName) {
      throw new Error('Folder name cannot be empty');
    }

    // Check for duplicate name at this level
    await this.validateNoDuplicateFolderName(trimmedName, parentId);

    const inserted = await this.db.insert(schema.folders).values({
      name: trimmedName,
      parentId,
    }).returning();

    return inserted[0];
  }

  /**
   * Moves a folder to a new parent
   * Enforces: No self-reference, no circular ancestry, no duplicate names
   */
  async moveFolder(folderId: number, newParentId: number | null): Promise<void> {
    // Rule: Cannot move folder to itself
    if (folderId === newParentId) {
      throw new Error('Cannot move folder to itself');
    }

    // Get folder to check current location and name collision
    const folder = await this.getFolderById(folderId);
    if (!folder) {
      throw new Error('Folder not found');
    }

    // Rule: Cannot move folder to the same location
    if (folder.parentId === newParentId) {
      throw new Error('Folder is already in this location');
    }

    // Rule: Cannot move folder to its own descendant
    if (newParentId !== null) {
      if (await this.isDescendantOf(newParentId, folderId)) {
        throw new Error('Cannot move folder to its own descendant');
      }
    }

    // Rule: No duplicate names at destination level
    await this.validateNoDuplicateFolderName(folder.name, newParentId, folderId);

    await this.db.update(schema.folders)
      .set({ parentId: newParentId })
      .where(eq(schema.folders.id, folderId));
  }

  /**
   * Deletes a folder and all descendants
   * Enforces: Cascade cleanup of file references
   */
  async deleteFolder(folderId: number): Promise<void> {
    const folderToDelete = await this.getFolderById(folderId);
    if (!folderToDelete) {
      throw new Error('Folder not found');
    }

    const parentFolderId = folderToDelete.parentId;
    const folderIdsToDelete = await this.getAllDescendantIds(folderId);

    // Clean up file references
    await this.cleanupFileReferences(folderIdsToDelete, parentFolderId);

    // Delete folder (cascade deletes children)
    await this.db.delete(schema.folders).where(eq(schema.folders.id, folderId));
  }

  // ============ File Operations ============

  /**
   * Adds a file to a folder
   * Enforces: No duplicate file in same folder, valid folder references
   */
  async addFileToFolder(fileId: number, folderId: number): Promise<void> {
    // Validate folder exists
    const folder = await this.getFolderById(folderId);
    if (!folder) {
      throw new Error('Folder not found');
    }

    const file = await this.getFileById(fileId);
    if (!file) {
      throw new Error('File not found');
    }

    const folderIds = this.parseFolderIds(file.folderIds);

    // Rule: File must only exist once in a specific folder
    if (folderIds.includes(folderId)) {
      throw new Error('The file already exists in this folder');
    }

    folderIds.push(folderId);
    await this.updateFileFolderIds(fileId, folderIds);
  }

  /**
   * Moves a file to a folder (replaces all folder associations)
   * Enforces: Valid folder reference or null for root
   */
  async moveFile(fileId: number, folderId: number | null): Promise<void> {
    if (folderId !== null) {
      const folder = await this.getFolderById(folderId);
      if (!folder) {
        throw new Error('Target folder not found');
      }
    }

    const file = await this.getFileById(fileId);
    if (!file) {
      throw new Error('File not found');
    }

    // Check if file is already in this location
    const currentFolderIds = this.parseFolderIds(file.folderIds);
    const newFolderIds = folderId !== null ? [folderId] : [];

    if (currentFolderIds.length === newFolderIds.length &&
        currentFolderIds.every((id, index) => id === newFolderIds[index])) {
      throw new Error('File is already in this location');
    }

    await this.updateFileFolderIds(fileId, newFolderIds);
  }

  /**
   * Creates a file with folder associations
   * Enforces: Valid folder references, no duplicate folder IDs
   */
  async createFile(
    filename: string,
    path: string,
    filetype: string | null,
    folderIds: number[] = []
  ): Promise<schema.File> {
    // Validate and deduplicate folder IDs
    const validatedFolderIds = await this.validateAndDeduplicateFolderIds(folderIds);

    const inserted = await this.db.insert(schema.files).values({
      filename,
      path,
      filetype,
      folderIds: validatedFolderIds.length > 0 ? JSON.stringify(validatedFolderIds) : null,
    }).returning();

    return inserted[0];
  }

  /**
   * Removes a file from a specific folder (but doesn't delete the file)
   */
  async removeFileFromFolder(fileId: number, folderId: number): Promise<void> {
    const file = await this.getFileById(fileId);
    if (!file) {
      throw new Error('File not found');
    }

    const folderIds = this.parseFolderIds(file.folderIds);
    const newFolderIds = folderIds.filter(id => id !== folderId);

    await this.updateFileFolderIds(fileId, newFolderIds);
  }

  /**
   * Imports a file by checking if a file with the same name exists
   * If it exists, prompts user and updates the existing file entry
   * Returns: { isUpdate: boolean, file: File, existingFile?: File }
   * Note: folderId = 0 means root, folderId > 0 means specific folder
   */
  async importFile(
    filename: string,
    path: string,
    filetype: string | null,
    folderId: number,
    confirmCallback: (existingFile: schema.File) => Promise<boolean>
  ): Promise<{ isUpdate: boolean; file: schema.File; existingFile?: schema.File }> {
    // Check if file with same name already exists
    const existingFile = await this.getFileByFilename(filename);

    if (existingFile) {
      // Check if file already exists in this specific folder or root
      const folderIds = this.parseFolderIds(existingFile.folderIds);

      console.log('[importFile] Checking duplicate:', {
        filename,
        folderId,
        existingFolderIds: folderIds,
        folderIdsLength: folderIds.length
      });

      // Check if file already exists in this specific location (folder or root)
      if (folderIds.includes(folderId)) {
        throw new Error('File already exists in this location');
      }

      // Prompt user for confirmation
      const shouldUpdate = await confirmCallback(existingFile);

      if (!shouldUpdate) {
        throw new Error('Import cancelled by user');
      }

      // Update existing file's path and filetype
      await this.db.update(schema.files)
        .set({
          path,
          filetype
        })
        .where(eq(schema.files.id, existingFile.id));

      // Add folder/root reference (keep existing folders)
      folderIds.push(folderId);
      await this.updateFileFolderIds(existingFile.id, folderIds);

      // Fetch updated file
      const updatedFile = await this.getFileById(existingFile.id);
      return {
        isUpdate: true,
        file: updatedFile!,
        existingFile
      };
    }

    // No existing file - create new one
    const newFile = await this.createFile(filename, path, filetype, [folderId]);

    return {
      isUpdate: false,
      file: newFile
    };
  }

  // ============ Helper Methods ============

  private async validateNoDuplicateFolderName(
    name: string,
    parentId: number | null,
    excludeFolderId?: number
  ): Promise<void> {
    const siblings = parentId === null
      ? await this.db.select().from(schema.folders).where(isNull(schema.folders.parentId))
      : await this.db.select().from(schema.folders).where(eq(schema.folders.parentId, parentId));

    const duplicate = siblings.find(
      f => f.name.toLowerCase() === name.toLowerCase() && f.id !== excludeFolderId
    );

    if (duplicate) {
      throw new Error('A folder with this name already exists at this level');
    }
  }

  private async isDescendantOf(potentialDescendantId: number, ancestorId: number): Promise<boolean> {
    const folder = await this.getFolderById(potentialDescendantId);
    if (!folder) return false;
    if (folder.parentId === ancestorId) return true;
    if (folder.parentId === null) return false;
    return this.isDescendantOf(folder.parentId, ancestorId);
  }

  private async getAllDescendantIds(folderId: number): Promise<number[]> {
    const children = await this.db.select().from(schema.folders)
      .where(eq(schema.folders.parentId, folderId));

    let allIds: number[] = [folderId];
    for (const child of children) {
      const childIds = await this.getAllDescendantIds(child.id);
      allIds = allIds.concat(childIds);
    }
    return allIds;
  }

  private async cleanupFileReferences(
    folderIdsToDelete: number[],
    parentFolderId: number | null
  ): Promise<void> {
    const files = await this.db.select().from(schema.files);

    for (const file of files) {
      if (!file.folderIds) continue;

      const folderIds = this.parseFolderIds(file.folderIds);
      const newFolderIds = folderIds.filter(id => !folderIdsToDelete.includes(id));

      // Only update if something changed
      if (folderIds.length !== newFolderIds.length) {
        // If file loses all folders, move to parent of deleted folder
        if (newFolderIds.length === 0 && parentFolderId !== null) {
          newFolderIds.push(parentFolderId);
        }

        await this.updateFileFolderIds(file.id, newFolderIds);
      }
    }
  }

  private async validateAndDeduplicateFolderIds(folderIds: number[]): Promise<number[]> {
    // Rule: No duplicate folder IDs (deduplicate using Set)
    const uniqueIds = Array.from(new Set(folderIds));

    // Rule: All folder IDs must reference existing folders (except 0 which is root)
    for (const folderId of uniqueIds) {
      if (folderId === 0) {
        // 0 is a special ID for root, skip validation
        continue;
      }
      const folder = await this.getFolderById(folderId);
      if (!folder) {
        throw new Error(`Folder with ID ${folderId} does not exist`);
      }
    }

    return uniqueIds;
  }

  private parseFolderIds(folderIdsJson: string | null): number[] {
    if (!folderIdsJson) return [];
    try {
      const parsed = JSON.parse(folderIdsJson);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private async updateFileFolderIds(fileId: number, folderIds: number[]): Promise<void> {
    const folderIdsJson = folderIds.length > 0 ? JSON.stringify(folderIds) : null;
    await this.db.update(schema.files)
      .set({ folderIds: folderIdsJson })
      .where(eq(schema.files.id, fileId));
  }

  private async getFolderById(folderId: number): Promise<schema.Folder | undefined> {
    const result = await this.db.select().from(schema.folders)
      .where(eq(schema.folders.id, folderId))
      .limit(1);
    return result[0];
  }

  private async getFileById(fileId: number): Promise<schema.File | undefined> {
    const result = await this.db.select().from(schema.files)
      .where(eq(schema.files.id, fileId))
      .limit(1);
    return result[0];
  }

  private async getFileByFilename(filename: string): Promise<schema.File | undefined> {
    const result = await this.db.select().from(schema.files)
      .where(eq(schema.files.filename, filename))
      .limit(1);
    return result[0];
  }

  // ============ Query Methods ============

  async getAllFolders(): Promise<schema.Folder[]> {
    return this.db.select().from(schema.folders);
  }

  async getAllFiles(): Promise<schema.File[]> {
    return this.db.select().from(schema.files);
  }

  async deleteFile(fileId: number): Promise<schema.File | undefined> {
    const file = await this.getFileById(fileId);
    if (file) {
      await this.db.delete(schema.files).where(eq(schema.files.id, fileId));
    }
    return file;
  }
}
