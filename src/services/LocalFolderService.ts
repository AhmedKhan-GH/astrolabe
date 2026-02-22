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
    newParentId: number
  ): Promise<{ success: boolean }> {
    await this.folderOps.moveFolder(
      folderId,
      newParentId,
      this.fileOps.getFolderIdsForFile.bind(this.fileOps),
      this.fileOps.removeFileFolderLink.bind(this.fileOps),
      this.fileOps.addFileFolderLink.bind(this.fileOps),
      this.fileOps.getAllFiles.bind(this.fileOps)
    );
    return { success: true };
  }

  async removeFolder(folderId: number): Promise<void> {
    await this.folderOps.removeFolder(
      folderId,
      this.fileOps.getFolderIdsForFile.bind(this.fileOps),
      this.fileOps.removeFileFolderLink.bind(this.fileOps),
      this.fileOps.addFileFolderLink.bind(this.fileOps),
      this.fileOps.getAllFiles.bind(this.fileOps)
    );
  }

  async deleteFolder(folderId: number): Promise<void> {
    await this.folderOps.deleteFolder(
      folderId,
      this.fileOps.getFolderIdsForFile.bind(this.fileOps),
      async (fileId: number) => { await this.fileOps.deleteFile(fileId); },
      this.fileOps.removeFileFolderLink.bind(this.fileOps),
      this.fileOps.getAllFiles.bind(this.fileOps)
    );
  }

  async toggleFolderExpanded(folderId: number): Promise<void> {
    await this.folderOps.toggleFolderExpanded(folderId);
  }

  async expandAllDescendants(folderId: number): Promise<void> {
    await this.folderOps.expandAllDescendants(folderId);
  }

  async collapseAllDescendants(folderId: number): Promise<void> {
    await this.folderOps.collapseAllDescendants(folderId);
  }

  async expandAllFolders(): Promise<void> {
    await this.folderOps.expandAllFolders();
  }

  async collapseAllFolders(): Promise<void> {
    await this.folderOps.collapseAllFolders();
  }

  async getAllFolders(): Promise<Folder[]> {
    return this.folderOps.getAllFolders();
  }

  async duplicateFolderTo(sourceFolderId: number, targetParentId: number): Promise<Folder> {
    return await this.folderOps.duplicateFolderTo(
      sourceFolderId,
      targetParentId,
      this.fileOps.addFileFolderLink.bind(this.fileOps),
      this.fileOps.getAllFiles.bind(this.fileOps)
    );
  }
}
