import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import * as schema from '../schema';

/**
 * DB Layer: File move primitives
 * Enforces data integrity constraints only
 * - File exists
 * - Folder exists (foreign key)
 * - Valid folder IDs structure
 */
export class FileMoveOperations {
  private db: BetterSQLite3Database<typeof schema>;

  constructor(db: BetterSQLite3Database<typeof schema>) {
    this.db = db;
  }

  /**
   * Gets a file by ID
   * @throws Error if file not found
   */
  async getFileById(fileId: number): Promise<schema.File> {
    const file = await this.db.query.files.findFirst({
      where: eq(schema.files.id, fileId)
    });

    if (!file) {
      throw new Error(`File with ID ${fileId} not found`);
    }

    return file;
  }

  /**
   * Gets a folder by ID
   * @throws Error if folder not found (unless folderId is 0 for root)
   */
  async getFolderById(folderId: number): Promise<schema.Folder | null> {
    if (folderId === 0) {
      return null; // Root folder is valid
    }

    const folder = await this.db.query.folders.findFirst({
      where: eq(schema.folders.id, folderId)
    });

    if (!folder) {
      throw new Error(`Folder with ID ${folderId} not found`);
    }

    return folder;
  }

  /**
   * Parses folder IDs from JSON string
   */
  parseFolderIds(folderIds: string | null): number[] {
    if (!folderIds) return [];
    try {
      return JSON.parse(folderIds);
    } catch {
      return [];
    }
  }

  /**
   * Updates file's folder IDs (primitive operation)
   * Does NOT validate business rules - just updates the data
   */
  async updateFileFolderIds(fileId: number, folderIds: number[]): Promise<void> {
    await this.db
      .update(schema.files)
      .set({ folderIds: JSON.stringify(folderIds) })
      .where(eq(schema.files.id, fileId));
  }

  /**
   * Expands a folder and all its ancestors (for UI visibility)
   */
  async expandAncestorFolders(folderId: number): Promise<void> {
    let currentId: number | null = folderId;

    while (currentId !== null && currentId !== 0) {
      const folder: schema.Folder | undefined = await this.db.query.folders.findFirst({
        where: eq(schema.folders.id, currentId)
      });

      if (!folder) break;

      // Expand this folder
      await this.db
        .update(schema.folders)
        .set({ isExpanded: true })
        .where(eq(schema.folders.id, currentId));

      currentId = folder.parentId;
    }
  }
}
