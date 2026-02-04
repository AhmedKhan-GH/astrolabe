import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../schema';

export class FileValidation {
  private db: BetterSQLite3Database<typeof schema>;

  constructor(db: BetterSQLite3Database<typeof schema>) {
    this.db = db;
  }

  /**
   * Validates and deduplicates folder IDs
   * @param folderIds - Array of folder IDs to validate
   * @param getFolderById - Function to retrieve folder by ID
   * @returns Deduplicated array of valid folder IDs
   * @throws Error if any folder ID is invalid
   */
  async validateAndDeduplicateFolderIds(
    folderIds: number[],
    getFolderById: (id: number) => Promise<schema.Folder | undefined>
  ): Promise<number[]> {
    // Rule: No duplicate folder IDs (deduplicate using Set)
    const uniqueIds = Array.from(new Set(folderIds));

    // Rule: All folder IDs must reference existing folders (except 0 which is root)
    for (const folderId of uniqueIds) {
      if (folderId === 0) {
        // 0 is a special ID for root, skip validation
        continue;
      }
      const folder = await getFolderById(folderId);
      if (!folder) {
        throw new Error(`Folder with ID ${folderId} does not exist`);
      }
    }

    return uniqueIds;
  }

  /**
   * Validates that a file doesn't already exist in a folder
   * @param folderIds - Current folder IDs of the file
   * @param targetFolderId - Folder ID to check
   * @throws Error if file already exists in the folder
   */
  validateFileNotInFolder(folderIds: number[], targetFolderId: number): void {
    if (folderIds.includes(targetFolderId)) {
      throw new Error('The file already exists in this folder');
    }
  }

  /**
   * Validates that a file location has changed
   * @param currentFolderIds - Current folder IDs
   * @param newFolderIds - New folder IDs
   * @throws Error if locations are the same
   */
  validateFileLocationChange(currentFolderIds: number[], newFolderIds: number[]): void {
    if (currentFolderIds.length === newFolderIds.length &&
        currentFolderIds.every((id, index) => id === newFolderIds[index])) {
      throw new Error('File is already in this location');
    }
  }

  /**
   * Validates that a file already exists in a specific location
   * @param folderIds - Current folder IDs
   * @param targetFolderId - Target folder ID to check
   * @throws Error if file already exists in the location
   */
  validateFileNotDuplicateInLocation(folderIds: number[], targetFolderId: number): void {
    if (folderIds.includes(targetFolderId)) {
      throw new Error('File already exists in this location');
    }
  }
}
