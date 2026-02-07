import type { File } from '../db/schema';

/**
 * Service interface for file operations
 * Implementations can be local (filesystem) or remote (API)
 */
export interface IFileService {
  /**
   * Import files by copying them to storage and adding to database
   * @param filePaths - Array of file paths to import
   * @param folderId - Optional folder ID to import into
   * @param confirmCallback - Optional callback for handling duplicate files
   * @returns Array of imported files
   */
  importFiles(
    filePaths: string[],
    folderId?: number,
    confirmCallback?: (existingFile: File) => Promise<boolean>
  ): Promise<File[]>;

  /**
   * Reference files by storing their path without copying
   * @param filePaths - Array of file paths to reference
   * @param folderId - Optional folder ID to reference into
   * @param confirmCallback - Optional callback for handling duplicate files
   * @returns Array of referenced files
   */
  referenceFiles(
    filePaths: string[],
    folderId?: number,
    confirmCallback?: (existingFile: File) => Promise<boolean>
  ): Promise<File[]>;

  /**
   * Move a file to a different folder
   * @param fileId - File ID to move
   * @param folderId - Target folder ID
   */
  moveFile(fileId: number, folderId: number): Promise<void>;

  /**
   * Add a file to an additional folder (file can exist in multiple folders)
   * @param fileId - File ID to add
   * @param folderId - Folder ID to add to
   */
  addFileToFolder(fileId: number, folderId: number): Promise<void>;

  /**
   * Remove a file from a folder (but don't delete the file)
   * @param fileId - File ID to remove
   * @param folderId - Folder ID to remove from
   */
  removeFileFromFolder(fileId: number, folderId: number): Promise<void>;

  /**
   * Delete a file completely (from all folders and storage)
   * @param fileId - File ID to delete
   */
  deleteFile(fileId: number): Promise<void>;

  /**
   * Get all files
   * @returns Array of all files
   */
  getAllFiles(): Promise<File[]>;
}
