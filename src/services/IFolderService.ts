import type { Folder } from '../db/schema';

/**
 * Service interface for folder operations
 * Implementations can be local (filesystem) or remote (API)
 */
export interface IFolderService {
  /**
   * Create a new folder
   * @param name - Folder name
   * @param parentId - Parent folder ID (0 for root)
   * @returns Created folder
   */
  createFolder(name: string, parentId?: number): Promise<Folder>;

  /**
   * Move a folder to a new parent
   * @param folderId - Folder ID to move
   * @param newParentId - New parent folder ID
   * @param forceMerge - If true, merge with existing folder of same name
   * @returns Success status
   */
  moveFolder(folderId: number, newParentId: number, forceMerge?: boolean): Promise<{ success: boolean; errorCode?: string }>;

  /**
   * Remove a folder and all descendants
   * @param folderId - Folder ID to remove
   */
  removeFolder(folderId: number): Promise<void>;

  /**
   * Toggle folder expanded state
   * @param folderId - Folder ID to toggle
   */
  toggleFolderExpanded(folderId: number): Promise<void>;

  /**
   * Get all folders
   * @returns Array of all folders
   */
  getAllFolders(): Promise<Folder[]>;
}
