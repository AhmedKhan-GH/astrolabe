import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../schema';

export class FolderQueries {
  private db: BetterSQLite3Database<typeof schema>;

  constructor(db: BetterSQLite3Database<typeof schema>) {
    this.db = db;
  }

  /**
   * Retrieves a folder by its ID
   * @param folderId - Folder ID to retrieve
   * @returns Folder or undefined if not found
   */
  async getFolderById(folderId: number): Promise<schema.Folder | undefined> {
    const result = await this.db.select().from(schema.folders)
      .where(eq(schema.folders.id, folderId))
      .limit(1);
    return result[0];
  }

  /**
   * Retrieves all folders
   * @returns Array of all folders
   */
  async getAllFolders(): Promise<schema.Folder[]> {
    return this.db.select().from(schema.folders);
  }

  /**
   * Gets all descendant folder IDs recursively
   * @param folderId - Root folder ID
   * @returns Array of folder IDs including the root
   */
  async getAllDescendantIds(folderId: number): Promise<number[]> {
    const children = await this.db.select().from(schema.folders)
      .where(eq(schema.folders.parentId, folderId));

    let allIds: number[] = [folderId];
    for (const child of children) {
      const childIds = await this.getAllDescendantIds(child.id);
      allIds = allIds.concat(childIds);
    }
    return allIds;
  }

  /**
   * Expands a folder (sets isExpanded to true)
   * @param folderId - Folder ID to expand
   */
  async expandFolder(folderId: number): Promise<void> {
    const folder = await this.getFolderById(folderId);
    if (!folder) {
      return; // Silently return if folder doesn't exist (e.g., root folder with id 0)
    }

    // Only update if not already expanded
    if (!folder.isExpanded) {
      await this.db.update(schema.folders)
        .set({ isExpanded: true })
        .where(eq(schema.folders.id, folderId));
    }
  }

  /**
   * Expands a folder and all its parent folders recursively
   * @param folderId - Folder ID to expand (along with parents)
   */
  async expandFolderAndParents(folderId: number): Promise<void> {
    // Return early for root (id 0) - no need to expand
    if (folderId === 0) {
      return;
    }

    // Expand the folder itself
    await this.expandFolder(folderId);

    // Recursively expand all parent folders
    const folder = await this.getFolderById(folderId);
    if (folder && folder.parentId !== 0) {
      await this.expandFolderAndParents(folder.parentId);
    }
  }

  /**
   * Toggles the expanded state of a folder
   * @param folderId - Folder ID to toggle
   * @throws Error if folder not found
   */
  async toggleFolderExpanded(folderId: number): Promise<void> {
    const folder = await this.getFolderById(folderId);
    if (!folder) {
      throw new Error('Folder not found');
    }

    await this.db.update(schema.folders)
      .set({ isExpanded: !folder.isExpanded })
      .where(eq(schema.folders.id, folderId));
  }
}
