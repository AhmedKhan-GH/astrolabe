import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../schema';
import { FolderValidation } from './FolderValidation';
import { FolderQueries } from './FolderQueries';
import { FileQueries } from './FileQueries';
import { FileValidation } from './FileValidation';
import { FolderOperations } from './FolderOperations';
import { FileOperations } from './FileOperations';

/**
 * Enforces file tree structural constraints at the data layer
 * All file and folder operations must go through this class
 *
 * This is a facade that delegates to specialized operation modules
 */
export class FileTreeOperations {
  private db: BetterSQLite3Database<typeof schema>;

  // Core modules
  private folderValidation: FolderValidation;
  private folderQueries: FolderQueries;
  private fileQueries: FileQueries;
  private fileValidation: FileValidation;
  private folderOperations: FolderOperations;
  private fileOperations: FileOperations;

  constructor(db: BetterSQLite3Database<typeof schema>) {
    this.db = db;

    // Initialize modules
    this.folderValidation = new FolderValidation(db);
    this.folderQueries = new FolderQueries(db);
    this.fileQueries = new FileQueries(db);
    this.fileValidation = new FileValidation(db);

    this.folderOperations = new FolderOperations(
      db,
      this.folderValidation,
      this.folderQueries,
      this.fileQueries
    );

    this.fileOperations = new FileOperations(
      db,
      this.fileValidation,
      this.fileQueries,
      this.folderQueries
    );
  }

  // ============ Folder Operations ============

  async createFolder(name: string, parentId: number = 0): Promise<schema.Folder> {
    return this.folderOperations.createFolder(name, parentId);
  }

  async moveFolder(folderId: number, newParentId: number): Promise<void> {
    return this.folderOperations.moveFolder(folderId, newParentId);
  }

  async removeFolder(folderId: number): Promise<void> {
    return this.folderOperations.removeFolder(folderId);
  }

  // ============ File Operations ============

  async createFile(
    filename: string,
    path: string,
    filetype: string | null,
    folderIds: number[] = [],
    storageType: 'import' | 'reference' = 'import'
  ): Promise<schema.File> {
    return this.fileOperations.createFile(filename, path, filetype, folderIds, storageType);
  }

  async addFileToFolder(fileId: number, folderId: number): Promise<void> {
    return this.fileOperations.addFileToFolder(fileId, folderId);
  }

  async moveFile(fileId: number, folderId: number): Promise<void> {
    return this.fileOperations.moveFile(fileId, folderId);
  }

  async removeFileFromFolder(fileId: number, folderId: number): Promise<void> {
    return this.fileOperations.removeFileFromFolder(fileId, folderId);
  }

  async importFile(
    filename: string,
    path: string,
    filetype: string | null,
    folderId: number,
    confirmCallback: (existingFile: schema.File) => Promise<boolean>,
    storageType: 'import' | 'reference' = 'import'
  ): Promise<{ isUpdate: boolean; file: schema.File; existingFile?: schema.File }> {
    return this.fileOperations.importFile(filename, path, filetype, folderId, confirmCallback, storageType);
  }

  // ============ Query Methods ============

  async getAllFolders(): Promise<schema.Folder[]> {
    return this.folderQueries.getAllFolders();
  }

  async getAllFiles(): Promise<schema.File[]> {
    return this.fileQueries.getAllFiles();
  }

  async deleteFile(fileId: number): Promise<schema.File | undefined> {
    return this.fileQueries.deleteFile(fileId);
  }

  async toggleFolderExpanded(folderId: number): Promise<void> {
    return this.folderQueries.toggleFolderExpanded(folderId);
  }
}
