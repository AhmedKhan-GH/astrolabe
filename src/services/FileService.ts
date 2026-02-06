import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../db/schema';
import { FileMoveOperations } from '../db/file-operations/FileMoveOperations';

/**
 * Service Layer: File operations with pre-flight validation
 * Validates business rules BEFORE performing operations
 * - Check logical constraints (duplicate locations, etc.)
 * - Coordinate multiple DB operations
 * - No side effects until validation passes
 */
export class FileService {
  private db: BetterSQLite3VdDatabase<typeof schema>;
  private fileMoveOps: FileMoveOperations;

  constructor(db: BetterSQLite3Database<typeof schema>) {
    this.db = db;
    this.fileMoveOps = new FileMoveOperations(db);
  }

  /**
   * Moves a file to a folder (replaces all folder associations)
   *
   * Pre-flight validation:
   * - File exists
   * - Target folder exists
   * - Not already in target location
   *
   * @param fileId - File ID to move
   * @param folderId - Target folder ID (0 for root)
   */
  async moveFile(fileId: number, folderId: number): Promise<void> {
    // Validation: File exists
    const file = await this.fileMoveOps.getFileById(fileId);

    // Validation: Folder exists
    await this.fileMoveOps.getFolderById(folderId);

    // Validation: Not already in this location
    const currentFolderIds = this.fileMoveOps.parseFolderIds(file.folderIds);
    const newFolderIds = [folderId];

    const currentSet = new Set(currentFolderIds);
    const newSet = new Set(newFolderIds);

    if ([...currentSet].every(id => newSet.has(id)) &&
        [...newSet].every(id => currentSet.has(id))) {
      throw new Error('File is already in this location');
    }

    // All validation passed - perform operation
    await this.fileMoveOps.updateFileFolderIds(fileId, newFolderIds);

    // Post-operation: Expand UI hierarchy
    if (folderId !== 0) {
      await this.fileMoveOps.expandAncestorFolders(folderId);
    }
  }
}
