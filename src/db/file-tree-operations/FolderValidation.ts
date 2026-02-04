import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../schema';

export class FolderValidation {
  private db: BetterSQLite3Database<typeof schema>;

  constructor(db: BetterSQLite3Database<typeof schema>) {
    this.db = db;
  }

  /**
   * Validates that no folder with the same name exists at the given parent level
   * @param name - Folder name to check
   * @param parentId - Parent folder ID (0 for root)
   * @param excludeFolderId - Optional folder ID to exclude from check (for rename operations)
   * @throws Error if duplicate name exists
   */
  async validateNoDuplicateFolderName(
    name: string,
    parentId: number,
    excludeFolderId?: number
  ): Promise<void> {
    const siblings = await this.db.select().from(schema.folders).where(eq(schema.folders.parentId, parentId));

    const duplicate = siblings.find(
      f => f.name.toLowerCase() === name.toLowerCase() && f.id !== excludeFolderId
    );

    if (duplicate) {
      throw new Error('A folder with this name already exists at this level');
    }
  }

  /**
   * Validates that a folder name is not empty
   * @param name - Folder name to validate
   * @returns Trimmed folder name
   * @throws Error if name is empty
   */
  validateFolderName(name: string): string {
    const trimmedName = name.trim();
    if (!trimmedName) {
      throw new Error('Folder name cannot be empty');
    }
    return trimmedName;
  }

  /**
   * Validates that a folder can be moved to a new parent
   * @param folderId - Folder to move
   * @param newParentId - Destination parent
   * @throws Error if move would violate constraints
   */
  validateFolderMove(folderId: number, newParentId: number): void {
    if (folderId === newParentId) {
      throw new Error('Cannot move folder to itself');
    }
  }

  /**
   * Checks if potentialDescendantId is a descendant of ancestorId
   * Used to prevent circular folder hierarchies
   * @param potentialDescendantId - ID to check
   * @param ancestorId - Potential ancestor ID
   * @param getFolderById - Function to retrieve folder by ID
   * @returns true if potentialDescendantId is a descendant of ancestorId
   */
  async isDescendantOf(
    potentialDescendantId: number,
    ancestorId: number,
    getFolderById: (id: number) => Promise<schema.Folder | undefined>
  ): Promise<boolean> {
    const folder = await getFolderById(potentialDescendantId);
    if (!folder) return false;
    if (folder.parentId === ancestorId) return true;
    if (folder.parentId === 0) return false;
    return this.isDescendantOf(folder.parentId, ancestorId, getFolderById);
  }
}
