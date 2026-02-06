import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../schema';
import { FileValidation } from './FileValidation';
import { FileQueries } from './FileQueries';
import { FolderQueries } from './FolderQueries';

/**
 * Handles file creation and import operations
 */
export class FileAddOperations {
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

      // Expand the target folder and all ancestor folders to show the newly added file
      if (folderId !== 0) {
        await this.folderQueries.expandAncestorFolders(folderId);
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

    // Expand the target folder and all ancestor folders to show the newly added file
    if (folderId !== 0) {
      await this.folderQueries.expandAncestorFolders(folderId);
    }

    return {
      isUpdate: false,
      file: newFile
    };
  }
}
