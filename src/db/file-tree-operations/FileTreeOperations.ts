import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../schema';
import { FolderValidation } from './FolderValidation';
import { FolderQueries } from './FolderQueries';
import { FileQueries } from './FileQueries';
import { FileValidation } from './FileValidation';
import { FolderOperations } from './FolderOperations';
import { FileOperations } from './FileOperations';
import { FolderMoveOperations } from './FolderMoveOperations';
import { FileMoveOperations } from './FileMoveOperations';
import { FileAddOperations } from './FileAddOperations';

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
  private folderMoveOperations: FolderMoveOperations;
  private fileMoveOperations: FileMoveOperations;
  private fileAddOperations: FileAddOperations;
  private folderOperations: FolderOperations;
  private fileOperations: FileOperations;

  constructor(db: BetterSQLite3Database<typeof schema>) {
    this.db = db;

    // Initialize modules
    this.folderValidation = new FolderValidation(this.db);
    this.folderQueries = new FolderQueries(this.db);
    this.fileQueries = new FileQueries(this.db);
    this.fileValidation = new FileValidation(this.db);

    this.folderMoveOperations = new FolderMoveOperations(
      this.db,
      this.folderValidation,
      this.folderQueries,
      this.fileQueries
    );

    this.fileMoveOperations = new FileMoveOperations(
      this.folderQueries,
      this.fileQueries
    );

    this.fileAddOperations = new FileAddOperations(
      this.db,
      this.fileValidation,
      this.fileQueries,
      this.folderQueries
    );

    this.folderOperations = new FolderOperations(
      this.db,
      this.folderValidation,
      this.folderQueries,
      this.fileQueries,
      this.folderMoveOperations
    );

    this.fileOperations = new FileOperations(
      this.db,
      this.fileValidation,
      this.fileQueries,
      this.folderQueries,
      this.fileMoveOperations,
      this.fileAddOperations
    );
  }

  // ============ Folder Operations ============

  async createFolder(name: string, parentId: number = 0): Promise<schema.Folder> {
    return this.folderOperations.createFolder(name, parentId);
  }

  async moveFolder(folderId: number, newParentId: number, forceMerge?: boolean): Promise<void> {
    return this.folderOperations.moveFolder(folderId, newParentId, forceMerge);
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
