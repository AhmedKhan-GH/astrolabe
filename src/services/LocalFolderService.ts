import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../db/schema';
import type { Folder } from '../db/schema';
import type { IFolderService } from './IFolderService';
import { FolderOperations } from '../db/operations/FolderOperations';
import { FileOperations } from '../db/operations/FileOperations';

/**
 * Local folder service implementation
 * Handles folder operations via domain layer
 */
export class LocalFolderService implements IFolderService {
  private folderOps: FolderOperations;
  private fileOps: FileOperations;

  constructor(db: BetterSQLite3Database<typeof schema>) {
    this.folderOps = new FolderOperations(db);
    this.fileOps = new FileOperations(db);
  }

  async createFolder(name: string, parentId?: number): Promise<Folder> {
    const normalizedParentId = parentId ?? 0;
    return this.folderOps.createFolder(name, normalizedParentId);
  }

  async moveFolder(
    folderId: number,
    newParentId: number,
    forceMerge?: boolean
  ): Promise<{ success: boolean; errorCode?: string }> {
    try {
      await this.folderOps.moveFolder(
        folderId,
        newParentId,
        forceMerge,
        this.fileOps.parseFolderIds.bind(this.fileOps),
        this.fileOps.updateFileFolderIds.bind(this.fileOps),
        this.fileOps.getAllFiles.bind(this.fileOps)
      );
      return { success: true };
    } catch (error) {
      if (error instanceof Error && error.message === 'DUPLICATE_FOLDER_NAME') {
        return { success: false, errorCode: 'DUPLICATE_FOLDER_NAME' };
      }
      throw error;
    }
  }

  async removeFolder(folderId: number): Promise<void> {
    await this.folderOps.removeFolder(
      folderId,
      this.fileOps.parseFolderIds.bind(this.fileOps),
      this.fileOps.updateFileFolderIds.bind(this.fileOps),
      this.fileOps.getAllFiles.bind(this.fileOps)
    );
  }

  async toggleFolderExpanded(folderId: number): Promise<void> {
    await this.folderOps.toggleFolderExpanded(folderId);
  }

  async getAllFolders(): Promise<Folder[]> {
    return this.folderOps.getAllFolders();
  }
}
