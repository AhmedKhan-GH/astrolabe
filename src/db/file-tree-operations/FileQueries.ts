import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../schema';

export class FileQueries {
  private db: BetterSQLite3Database<typeof schema>;

  constructor(db: BetterSQLite3Database<typeof schema>) {
    this.db = db;
  }

  /**
   * Retrieves a file by its ID
   * @param fileId - File ID to retrieve
   * @returns File or undefined if not found
   */
  async getFileById(fileId: number): Promise<schema.File | undefined> {
    const result = await this.db.select().from(schema.files)
      .where(eq(schema.files.id, fileId))
      .limit(1);
    return result[0];
  }

  /**
   * Retrieves a file by filename and storage type
   * @param filename - Name of the file
   * @param storageType - Storage type ('import' or 'reference')
   * @returns File or undefined if not found
   */
  async getFileByFilenameAndStorageType(
    filename: string,
    storageType: 'import' | 'reference'
  ): Promise<schema.File | undefined> {
    const allFiles = await this.db.select().from(schema.files)
      .where(eq(schema.files.filename, filename));

    // Filter by storage type
    return allFiles.find(file => file.fileStorageType === storageType);
  }

  /**
   * Retrieves all files
   * @returns Array of all files
   */
  async getAllFiles(): Promise<schema.File[]> {
    return this.db.select().from(schema.files);
  }

  /**
   * Deletes a file by its ID
   * @param fileId - File ID to delete
   * @returns Deleted file or undefined if not found
   */
  async deleteFile(fileId: number): Promise<schema.File | undefined> {
    const file = await this.getFileById(fileId);
    if (file) {
      await this.db.delete(schema.files).where(eq(schema.files.id, fileId));
    }
    return file;
  }

  /**
   * Parses folder IDs from JSON string
   * @param folderIdsJson - JSON string containing folder IDs
   * @returns Array of folder IDs
   */
  parseFolderIds(folderIdsJson: string | null): number[] {
    if (!folderIdsJson) return [];
    try {
      const parsed = JSON.parse(folderIdsJson);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  /**
   * Updates a file's folder IDs
   * @param fileId - File ID to update
   * @param folderIds - New array of folder IDs
   */
  async updateFileFolderIds(fileId: number, folderIds: number[]): Promise<void> {
    const folderIdsJson = folderIds.length > 0 ? JSON.stringify(folderIds) : null;
    await this.db.update(schema.files)
      .set({ folderIds: folderIdsJson })
      .where(eq(schema.files.id, fileId));
  }
}
