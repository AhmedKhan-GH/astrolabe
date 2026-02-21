import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../db/schema';
import type { File } from '../db/schema';
import type { IFileService } from './IFileService';
import { FileOperations } from '../db/operations/FileOperations';
import { FolderOperations } from '../db/operations/FolderOperations';
import { logger } from '../utils/logger';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

/**
 * Local file service implementation
 * Handles filesystem operations + database operations via domain layer
 */
export class LocalFileService implements IFileService {
  private fileOps: FileOperations;
  private folderOps: FolderOperations;
  private filesDir: string;

  constructor(db: BetterSQLite3Database<typeof schema>, dataDirectory: string) {
    this.fileOps = new FileOperations(db);
    this.folderOps = new FolderOperations(db);
    this.filesDir = path.join(dataDirectory, 'files');
  }

  private ensureFilesDirectory(): void {
    if (!fs.existsSync(this.filesDir)) {
      fs.mkdirSync(this.filesDir, { recursive: true });
    }
  }

  async importFiles(
    filePaths: string[],
    folderId?: number,
    confirmCallback?: (existingFile: schema.File) => Promise<boolean>
  ): Promise<File[]> {
    this.ensureFilesDirectory();

    const importedFiles: File[] = [];

    for (const filePath of filePaths) {
      const filename = path.basename(filePath);
      const hash = crypto.randomBytes(8).toString('hex');
      const hashDir = path.join(this.filesDir, hash);

      if (!fs.existsSync(hashDir)) {
        fs.mkdirSync(hashDir, { recursive: true });
      }

      const storedPath = path.join(hashDir, filename);

      try {
        fs.copyFileSync(filePath, storedPath);

        const ext = path.extname(filePath);
        const result = await this.fileOps.importFile(
          filename,
          hash,
          ext ? ext.slice(1) : null,
          folderId !== undefined ? folderId : 0,
          'import',
          confirmCallback || (async () => false),
          this.folderOps.expandAncestorFolders.bind(this.folderOps)
        );

        if (!result.cancelled && result.file) {
          importedFiles.push(result.file);
        }
      } catch (error) {
        if (fs.existsSync(storedPath)) fs.unlinkSync(storedPath);
        if (fs.existsSync(hashDir)) {
          try { fs.rmdirSync(hashDir); }
          catch (e) { logger.error({ error: e }, 'Error cleaning up hash directory'); }
        }
        throw error;
      }
    }

    return importedFiles;
  }

  async referenceFiles(
    filePaths: string[],
    folderId?: number,
    confirmCallback?: (existingFile: schema.File) => Promise<boolean>
  ): Promise<File[]> {
    const referencedFiles: File[] = [];

    for (const filePath of filePaths) {
      const filename = path.basename(filePath);
      const ext = path.extname(filePath);

      const result = await this.fileOps.importFile(
        filename,
        filePath,
        ext ? ext.slice(1) : null,
        folderId !== undefined ? folderId : 0,
        'reference',
        confirmCallback || (async () => false),
        this.folderOps.expandAncestorFolders.bind(this.folderOps)
      );

      if (!result.cancelled && result.file) {
        referencedFiles.push(result.file);
      }
    }

    return referencedFiles;
  }

  async moveFile(fileId: number, folderId: number): Promise<void> {
    await this.fileOps.moveFile(
      fileId,
      folderId,
      this.folderOps.getFolderById.bind(this.folderOps),
      this.folderOps.expandAncestorFolders.bind(this.folderOps)
    );
  }

  async addFileToFolder(fileId: number, folderId: number): Promise<void> {
    await this.fileOps.addFileToFolder(
      fileId,
      folderId,
      this.folderOps.getFolderById.bind(this.folderOps),
      this.folderOps.expandAncestorFolders.bind(this.folderOps)
    );
  }

  async removeFileFromFolder(fileId: number, folderId: number): Promise<void> {
    await this.fileOps.removeFileFromFolder(fileId, folderId);
  }

  async deleteFile(fileId: number): Promise<void> {
    const file = await this.fileOps.deleteFile(fileId);

    if (file && file.path && file.fileStorageType === 'import') {
      const hashDir = path.join(this.filesDir, file.path);

      if (fs.existsSync(hashDir)) {
        try {
          const files = fs.readdirSync(hashDir);
          for (const f of files) {
            fs.unlinkSync(path.join(hashDir, f));
          }
          fs.rmdirSync(hashDir);
        } catch (error) {
          logger.error({ error }, 'Error deleting hash directory');
        }
      }
    }
  }

  async getAllFiles(): Promise<File[]> {
    return this.fileOps.getAllFiles();
  }
}
