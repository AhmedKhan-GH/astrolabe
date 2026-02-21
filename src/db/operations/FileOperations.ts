import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../schema';
import type { File } from '../schema';

/**
 * File operations - handles all file-related business logic
 * Combines queries, validation, and operations in one place
 */
export class FileOperations {
  private db: BetterSQLite3Database<typeof schema>;

  constructor(db: BetterSQLite3Database<typeof schema>) {
    this.db = db;
  }

  // ============ Query Methods ============

  async getFileById(fileId: number): Promise<File | undefined> {
    const result = await this.db.select().from(schema.files)
      .where(eq(schema.files.id, fileId))
      .limit(1);
    return result[0];
  }

  async getFileByFilenameAndStorageType(
    filename: string,
    storageType: 'import' | 'reference'
  ): Promise<File | undefined> {
    const allFiles = await this.db.select().from(schema.files)
      .where(eq(schema.files.filename, filename));
    return allFiles.find(file => file.fileStorageType === storageType);
  }

  async getAllFiles(): Promise<File[]> {
    return this.db.select().from(schema.files);
  }

  async deleteFile(fileId: number): Promise<File | undefined> {
    const file = await this.getFileById(fileId);
    if (file) {
      await this.db.delete(schema.files).where(eq(schema.files.id, fileId));
    }
    return file;
  }

  // ============ Helper Methods ============

  parseFolderIds(folderIdsJson: string | null): number[] {
    if (!folderIdsJson) return [];
    try {
      const parsed = JSON.parse(folderIdsJson);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  async updateFileFolderIds(fileId: number, folderIds: number[]): Promise<void> {
    const folderIdsJson = folderIds.length > 0 ? JSON.stringify(folderIds) : null;
    await this.db.update(schema.files)
      .set({ folderIds: folderIdsJson })
      .where(eq(schema.files.id, fileId));
  }

  // ============ Validation Methods ============

  private validateFileNotInFolder(folderIds: number[], targetFolderId: number): void {
    if (folderIds.includes(targetFolderId)) {
      throw new Error('The file already exists in this folder');
    }
  }

  // ============ Business Operations ============

  /**
   * Import a file with duplicate detection
   */
  async importFile(
    filename: string,
    path: string,
    filetype: string | null,
    folderId: number,
    storageType: 'import' | 'reference',
    confirmCallback: (existingFile: File) => Promise<boolean>,
    expandAncestors: (folderId: number) => Promise<void>
  ): Promise<{ isUpdate: boolean; file?: File; existingFile?: File; cancelled?: boolean }> {
    // Check for existing file
    const existingFile = await this.getFileByFilenameAndStorageType(filename, storageType);

    if (existingFile) {
      const folderIds = this.parseFolderIds(existingFile.folderIds);

      // Validate not duplicate in location
      this.validateFileNotInFolder(folderIds, folderId);

      // Ask user for confirmation
      const shouldUpdate = await confirmCallback(existingFile);
      if (!shouldUpdate) {
        return { isUpdate: false, cancelled: true, existingFile };
      }

      // Update metadata
      await this.db.update(schema.files)
        .set({ path, filetype, fileStorageType: storageType })
        .where(eq(schema.files.id, existingFile.id));

      // Add to folder
      folderIds.push(folderId);
      await this.updateFileFolderIds(existingFile.id, folderIds);

      // Expand UI
      if (folderId !== 0) {
        await expandAncestors(folderId);
      }

      return {
        isUpdate: true,
        file: { ...existingFile, path, filetype, fileStorageType: storageType, folderIds: JSON.stringify(folderIds) },
        existingFile
      };
    }

    // Create new file
    const inserted = await this.db.insert(schema.files).values({
      filename,
      path,
      filetype,
      folderIds: JSON.stringify([folderId]),
      fileStorageType: storageType,
    }).returning();

    if (folderId !== 0) {
      await expandAncestors(folderId);
    }

    return {
      isUpdate: false,
      file: inserted[0]
    };
  }

  /**
   * Move file to different folder
   */
  async moveFile(
    fileId: number,
    folderId: number,
    getFolderById: (id: number) => Promise<schema.Folder | undefined>,
    expandAncestors: (folderId: number) => Promise<void>
  ): Promise<void> {
    // Validate folder exists
    const folder = await getFolderById(folderId);
    if (!folder && folderId !== 0) {
      throw new Error('Target folder not found');
    }

    const file = await this.getFileById(fileId);
    if (!file) {
      throw new Error('File not found');
    }

    // Check if already in this location
    const currentFolderIds = this.parseFolderIds(file.folderIds);
    const newFolderIds = [folderId];

    if (currentFolderIds.length === 1 && currentFolderIds[0] === folderId) {
      throw new Error('File is already in this location');
    }

    await this.updateFileFolderIds(fileId, newFolderIds);

    if (folderId !== 0) {
      await expandAncestors(folderId);
    }
  }

  /**
   * Add file to folder (can exist in multiple folders)
   */
  async addFileToFolder(
    fileId: number,
    folderId: number,
    getFolderById: (id: number) => Promise<schema.Folder | undefined>,
    expandAncestors: (folderId: number) => Promise<void>
  ): Promise<void> {
    // Validate folder exists
    if (folderId !== 0) {
      const folder = await getFolderById(folderId);
      if (!folder) {
        throw new Error('Folder not found');
      }
    }

    const file = await this.getFileById(fileId);
    if (!file) {
      throw new Error('File not found');
    }

    const folderIds = this.parseFolderIds(file.folderIds);

    // Validate not duplicate
    this.validateFileNotInFolder(folderIds, folderId);

    folderIds.push(folderId);
    await this.updateFileFolderIds(fileId, folderIds);

    if (folderId !== 0) {
      await expandAncestors(folderId);
    }
  }

  /**
   * Remove file from folder
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
}
