import { eq, and } from 'drizzle-orm';
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

  async getAllFiles(): Promise<(File & { folderIds: string })[]> {
    const files = await this.db.select().from(schema.files);

    // Get folderIds for each file from junction table
    const filesWithFolders = await Promise.all(
      files.map(async (file) => {
        const folderIds = await this.getFolderIdsForFile(file.id);
        return {
          ...file,
          folderIds: JSON.stringify(folderIds)
        };
      })
    );

    return filesWithFolders;
  }

  async deleteFile(fileId: number): Promise<File | undefined> {
    const file = await this.getFileById(fileId);
    if (file) {
      // Delete file and cascade will remove file_folders entries
      await this.db.delete(schema.files).where(eq(schema.files.id, fileId));
    }
    return file;
  }

  // ============ Helper Methods ============

  /**
   * Get all folder IDs that a file belongs to
   */
  async getFolderIdsForFile(fileId: number): Promise<number[]> {
    const result = await this.db.select({ folderId: schema.fileFolders.folderId })
      .from(schema.fileFolders)
      .where(eq(schema.fileFolders.fileId, fileId));
    return result.map(r => r.folderId);
  }

  /**
   * Check if a file is in a specific folder
   */
  async isFileInFolder(fileId: number, folderId: number): Promise<boolean> {
    const result = await this.db.select()
      .from(schema.fileFolders)
      .where(and(
        eq(schema.fileFolders.fileId, fileId),
        eq(schema.fileFolders.folderId, folderId)
      ))
      .limit(1);
    return result.length > 0;
  }

  /**
   * Add file-folder relationship
   */
  async addFileFolderLink(fileId: number, folderId: number): Promise<void> {
    await this.db.insert(schema.fileFolders).values({
      fileId,
      folderId,
    });
  }

  /**
   * Remove file-folder relationship
   */
  async removeFileFolderLink(fileId: number, folderId: number): Promise<void> {
    await this.db.delete(schema.fileFolders)
      .where(and(
        eq(schema.fileFolders.fileId, fileId),
        eq(schema.fileFolders.folderId, folderId)
      ));
  }

  /**
   * Remove all folder links for a file
   */
  async removeAllFileFolderLinks(fileId: number): Promise<void> {
    await this.db.delete(schema.fileFolders)
      .where(eq(schema.fileFolders.fileId, fileId));
  }

  // ============ Validation Methods ============

  private async validateFileNotInFolder(fileId: number, targetFolderId: number): Promise<void> {
    const isInFolder = await this.isFileInFolder(fileId, targetFolderId);
    if (isInFolder) {
      throw new Error('Failed to add file: The file already exists in this folder');
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
      // Validate not duplicate in location
      await this.validateFileNotInFolder(existingFile.id, folderId);

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
      await this.addFileFolderLink(existingFile.id, folderId);

      // Expand UI
      if (folderId !== 0) {
        await expandAncestors(folderId);
      }

      return {
        isUpdate: true,
        file: { ...existingFile, path, filetype, fileStorageType: storageType },
        existingFile
      };
    }

    // Create new file
    const inserted = await this.db.insert(schema.files).values({
      filename,
      path,
      filetype,
      fileStorageType: storageType,
    }).returning();

    // Add to folder
    await this.addFileFolderLink(inserted[0].id, folderId);

    if (folderId !== 0) {
      await expandAncestors(folderId);
    }

    return {
      isUpdate: false,
      file: inserted[0]
    };
  }

  /**
   * Move file to different folder (replaces all existing folder associations)
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
      throw new Error('Failed to move file: Target folder not found');
    }

    const file = await this.getFileById(fileId);
    if (!file) {
      throw new Error('Failed to move file: File not found');
    }

    // Check if already in this location
    const currentFolderIds = await this.getFolderIdsForFile(fileId);

    if (currentFolderIds.length === 1 && currentFolderIds[0] === folderId) {
      throw new Error('Failed to move file: File is already in this location');
    }

    // Remove all existing folder links and add new one
    await this.removeAllFileFolderLinks(fileId);
    await this.addFileFolderLink(fileId, folderId);

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
        throw new Error('Failed to add file: Folder not found');
      }
    }

    const file = await this.getFileById(fileId);
    if (!file) {
      throw new Error('Failed to add file: File not found');
    }

    // Validate not duplicate
    await this.validateFileNotInFolder(fileId, folderId);

    await this.addFileFolderLink(fileId, folderId);

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
      throw new Error('Failed to remove file: File not found');
    }

    await this.removeFileFolderLink(fileId, folderId);
  }
}
