import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../schema';
import { FileValidation } from './FileValidation';
import { FileQueries } from './FileQueries';
import { FolderQueries } from './FolderQueries';

export class FileOperations {
  private db: BetterSQLite3Database<typeof schema>;
  private validation: FileValidation;
  private fileQueries: FileQueries;
  private folderQueries: FolderQueries;

  constructor(
    db: BetterSQLite3Database<typeof schema>,
    validation: FileValidation,
    fileQueries: FileQueries,
    folderQueries: FolderQueries
  ) {
    this.db = db;
    this.validation = validation;
    this.fileQueries = fileQueries;
    this.folderQueries = folderQueries;
  }

  /**
   * Creates a file with folder associations
   * Enforces: Valid folder references, no duplicate folder IDs
   * @param filename - Name of the file
   * @param path - Path to the file
   * @param filetype - Type of the file (can be null)
   * @param folderIds - Array of folder IDs
   * @param storageType - Storage type ('import' or 'reference')
   * @returns Created file
   */
  async createFile(
    filename: string,
    path: string,
    filetype: string | null,
    folderIds: number[] = [],
    storageType: 'import' | 'reference' = 'import'
  ): Promise<schema.File> {
    // Validate and deduplicate folder IDs
    const validatedFolderIds = await this.validation.validateAndDeduplicateFolderIds(
      folderIds,
      this.folderQueries.getFolderById.bind(this.folderQueries)
    );

    const inserted = await this.db.insert(schema.files).values({
      filename,
      path,
      filetype,
      folderIds: validatedFolderIds.length > 0 ? JSON.stringify(validatedFolderIds) : null,
      fileStorageType: storageType,
    }).returning();

    return inserted[0];
  }

  /**
   * Adds a file to a folder
   * Enforces: No duplicate file in same folder, valid folder references
   * @param fileId - File ID to add
   * @param folderId - Folder ID to add to (0 for root)
   */
  async addFileToFolder(fileId: number, folderId: number): Promise<void> {
    // Validate folder exists (0 is a special case for root)
    if (folderId !== 0) {
      const folder = await this.folderQueries.getFolderById(folderId);
      if (!folder) {
        throw new Error('Folder not found');
      }
    }

    const file = await this.fileQueries.getFileById(fileId);
    if (!file) {
      throw new Error('File not found');
    }

    const folderIds = this.fileQueries.parseFolderIds(file.folderIds);

    // Rule: File must only exist once in a specific folder
    this.validation.validateFileNotInFolder(folderIds, folderId);

    folderIds.push(folderId);
    await this.fileQueries.updateFileFolderIds(fileId, folderIds);

    // Expand the target folder and all parent folders to show the newly added file
    if (folderId !== 0) {
      await this.folderQueries.expandFolderAndParents(folderId);
    }
  }

  /**
   * Moves a file to a folder (replaces all folder associations)
   * Enforces: Valid folder reference
   * @param fileId - File ID to move
   * @param folderId - Target folder ID (0 for root)
   */
  async moveFile(fileId: number, folderId: number): Promise<void> {
    if (folderId !== 0) {
      const folder = await this.folderQueries.getFolderById(folderId);
      if (!folder) {
        throw new Error('Target folder not found');
      }
    }

    const file = await this.fileQueries.getFileById(fileId);
    if (!file) {
      throw new Error('File not found');
    }

    // Check if file is already in this location
    const currentFolderIds = this.fileQueries.parseFolderIds(file.folderIds);
    const newFolderIds = [folderId];

    this.validation.validateFileLocationChange(currentFolderIds, newFolderIds);

    await this.fileQueries.updateFileFolderIds(fileId, newFolderIds);
  }

  /**
   * Removes a file from a specific folder (but doesn't delete the file)
   * @param fileId - File ID to remove
   * @param folderId - Folder ID to remove from
   */
  async removeFileFromFolder(fileId: number, folderId: number): Promise<void> {
    const file = await this.fileQueries.getFileById(fileId);
    if (!file) {
      throw new Error('File not found');
    }

    const folderIds = this.fileQueries.parseFolderIds(file.folderIds);
    const newFolderIds = folderIds.filter(id => id !== folderId);

    await this.fileQueries.updateFileFolderIds(fileId, newFolderIds);
  }

  /**
   * Imports a file by checking if a file with the same name and storage type exists
   * If it exists, prompts user and updates the existing file entry
   * @param filename - Name of the file
   * @param path - Path to the file
   * @param filetype - Type of the file (can be null)
   * @param folderId - Folder ID to import to (0 for root)
   * @param confirmCallback - Callback to confirm update of existing file
   * @param storageType - Storage type ('import' or 'reference')
   * @returns Object with isUpdate flag, file, and optional existingFile
   */
  async importFile(
    filename: string,
    path: string,
    filetype: string | null,
    folderId: number,
    confirmCallback: (existingFile: schema.File) => Promise<boolean>,
    storageType: 'import' | 'reference' = 'import'
  ): Promise<{ isUpdate: boolean; file: schema.File; existingFile?: schema.File }> {
    // Check if file with same name AND storage type already exists
    const existingFile = await this.fileQueries.getFileByFilenameAndStorageType(filename, storageType);

    if (existingFile) {
      // Check if file already exists in this specific folder or root
      const folderIds = this.fileQueries.parseFolderIds(existingFile.folderIds);

      console.log('[importFile] Checking duplicate:', {
        filename,
        storageType,
        folderId,
        existingFolderIds: folderIds,
        folderIdsLength: folderIds.length
      });

      // Check if file already exists in this specific location (folder or root)
      this.validation.validateFileNotDuplicateInLocation(folderIds, folderId);

      // Prompt user for confirmation
      const shouldUpdate = await confirmCallback(existingFile);

      if (!shouldUpdate) {
        throw new Error('Import cancelled by user');
      }

      // Update existing file's path, filetype, and storage type
      await this.db.update(schema.files)
        .set({
          path,
          filetype,
          fileStorageType: storageType
        })
        .where(eq(schema.files.id, existingFile.id));

      // Add folder/root reference (keep existing folders)
      folderIds.push(folderId);
      await this.fileQueries.updateFileFolderIds(existingFile.id, folderIds);

      // Expand the target folder and all parent folders to show the newly added file
      if (folderId !== 0) {
        await this.folderQueries.expandFolderAndParents(folderId);
      }

      // Fetch updated file
      const updatedFile = await this.fileQueries.getFileById(existingFile.id);
      return {
        isUpdate: true,
        file: updatedFile!,
        existingFile
      };
    }

    // No existing file - create new one
    const newFile = await this.createFile(filename, path, filetype, [folderId], storageType);

    // Expand the target folder and all parent folders to show the newly added file
    if (folderId !== 0) {
      await this.folderQueries.expandFolderAndParents(folderId);
    }

    return {
      isUpdate: false,
      file: newFile
    };
  }
}
