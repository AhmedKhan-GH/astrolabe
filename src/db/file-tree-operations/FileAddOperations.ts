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
   * Imports a file (physically stored) by checking if a file with the same name exists
   * If it exists, prompts user and updates the existing file entry
   * @param filename - Name of the file
   * @param path - Path to the file
   * @param filetype - Type of the file (can be null)
   * @param folderId - Folder ID to add to (0 for root)
   * @param confirmCallback - Callback to confirm update of existing file
   * @returns Object with isUpdate flag, file, and optional existingFile
   */
  async importFile(
    filename: string,
    path: string,
    filetype: string | null,
    folderId: number,
    confirmCallback: (existingFile: schema.File) => Promise<boolean>
  ): Promise<{ isUpdate: boolean; file: schema.File; existingFile?: schema.File }> {
    return this.addFile(filename, path, filetype, folderId, confirmCallback, 'import');
  }

  /**
   * References a file (path only, not physically stored) by checking if a file with the same name exists
   * If it exists, prompts user and updates the existing file entry
   * @param filename - Name of the file
   * @param path - Path to the file
   * @param filetype - Type of the file (can be null)
   * @param folderId - Folder ID to add to (0 for root)
   * @param confirmCallback - Callback to confirm update of existing file
   * @returns Object with isUpdate flag, file, and optional existingFile
   */
  async referenceFile(
    filename: string,
    path: string,
    filetype: string | null,
    folderId: number,
    confirmCallback: (existingFile: schema.File) => Promise<boolean>
  ): Promise<{ isUpdate: boolean; file: schema.File; existingFile?: schema.File }> {
    return this.addFile(filename, path, filetype, folderId, confirmCallback, 'reference');
  }

  /**
   * Adds a file by checking if a file with the same name and storage type exists
   * If it exists, prompts user and updates the existing file entry
   * @param filename - Name of the file
   * @param path - Path to the file
   * @param filetype - Type of the file (can be null)
   * @param folderId - Folder ID to add to (0 for root)
   * @param confirmCallback - Callback to confirm update of existing file
   * @param storageType - Storage type ('import' or 'reference')
   * @returns Object with isUpdate flag, file, and optional existingFile
   */
  private async addFile(
    filename: string,
    path: string,
    filetype: string | null,
    folderId: number,
    confirmCallback: (existingFile: schema.File) => Promise<boolean>,
    storageType: 'import' | 'reference'
  ): Promise<{ isUpdate: boolean; file: schema.File; existingFile?: schema.File }> {
    // Query database for a file matching both filename AND storage type
    const existingFile = await this.fileQueries.getFileByFilenameAndStorageType(filename, storageType);

    if (existingFile) {
      // Parse the JSON array of folder IDs from the existing file record
      const folderIds = this.fileQueries.parseFolderIds(existingFile.folderIds);

      // Verify the file doesn't already exist in the target location (throws if duplicate)
      this.validation.validateFileNotDuplicateInLocation(folderIds, folderId);

      // Ask user if they want to update the existing file (add to another folder)
      const shouldUpdate = await confirmCallback(existingFile);

      // User declined - abort operation
      if (!shouldUpdate) {
        throw new Error('Add file cancelled by user');
      }

      // Update the existing file's metadata (path/filetype/storageType)
      await this.db.update(schema.files)
        .set({
          path,
          filetype,
          fileStorageType: storageType
        })
        .where(eq(schema.files.id, existingFile.id));

      // Add the new folder to the file's folder list (file can exist in multiple folders)
      folderIds.push(folderId);
      await this.fileQueries.updateFileFolderIds(existingFile.id, folderIds);

      // Make the folder hierarchy visible in the UI (skip if root)
      if (folderId !== 0) {
        await this.folderQueries.expandAncestorFolders(folderId);
      }

      // Return updated file data without refetching from database
      const updatedFile: schema.File = {
        ...existingFile,
        path,
        filetype,
        fileStorageType: storageType,
        folderIds: JSON.stringify(folderIds)
      };

      return {
        isUpdate: true,
        file: updatedFile,
        existingFile
      };
    }

    // No existing file found - create a new file record

    // Validate that the target folder exists (throws if not found)
    if (folderId !== 0) {
      await this.folderQueries.getFolderById(folderId);
    }

    // Insert new file record into database
    const inserted = await this.db.insert(schema.files).values({
      filename,
      path,
      filetype,
      folderIds: JSON.stringify([folderId]),
      fileStorageType: storageType,
    }).returning();

    // Extract the newly created file from the result array
    const newFile = inserted[0];

    // Make the folder hierarchy visible in the UI (skip if root)
    if (folderId !== 0) {
      await this.folderQueries.expandAncestorFolders(folderId);
    }

    return {
      isUpdate: false,
      file: newFile
    };
  }
}
