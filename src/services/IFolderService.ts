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
   * Automatically merges with existing folder if name conflict occurs
   * @param folderId - Folder ID to move
   * @param newParentId - New parent folder ID
   * @returns Success status
   */
  moveFolder(folderId: number, newParentId: number): Promise<{ success: boolean }>;

  /**
   * Remove a folder (moves children to parent)
   * @param folderId - Folder ID to remove
   */
  removeFolder(folderId: number): Promise<void>;

  /**
   * Delete a folder and cascade delete all descendants
   * Files unique to deleted folders are deleted, files in other folders have folder references updated
   * @param folderId - Folder ID to delete
   */
  deleteFolder(folderId: number): Promise<void>;

  /**
   * Toggle folder expanded state
   * @param folderId - Folder ID to toggle
   */
  toggleFolderExpanded(folderId: number): Promise<void>;

  /**
   * Expand all descendant folders
   * @param folderId - Folder ID to expand (including all descendants)
   */
  expandAllDescendants(folderId: number): Promise<void>;

  /**
   * Collapse all descendant folders
   * @param folderId - Folder ID to collapse (including all descendants)
   */
  collapseAllDescendants(folderId: number): Promise<void>;

  /**
   * Expand all folders in the entire tree
   */
  expandAllFolders(): Promise<void>;

  /**
   * Collapse all folders in the entire tree
   */
  collapseAllFolders(): Promise<void>;

  /**
   * Get all folders
   * @returns Array of all folders
   */
  getAllFolders(): Promise<Folder[]>;

  /**
   * Duplicate a folder structure and add it as a child of target folder
   * @param sourceFolderId - Source folder ID to duplicate
   * @param targetParentId - Target parent folder ID where duplicate will be added
   * @returns The newly created folder
   */
  duplicateFolderTo(sourceFolderId: number, targetParentId: number): Promise<Folder>;
}
