import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../db/schema';
import type { IFileService } from './IFileService';
import type { IFolderService } from './IFolderService';
import { LocalFileService } from './LocalFileService';
import { LocalFolderService } from './LocalFolderService';
import { RemoteFileService } from './RemoteFileService';
import { RemoteFolderService } from './RemoteFolderService';

export interface ServiceConfig {
  mode: 'local' | 'remote';
  db?: BetterSQLite3Database<typeof schema>;
  dataDir?: string;
  apiUrl?: string;
  apiKey?: string;
}

/**
 * Factory for creating and managing file and folder services based on configuration
 * Services are cached as singletons to avoid duplicate instances
 */
export class ServiceFactory {
  private static fileServiceInstance: IFileService | null = null;
  private static folderServiceInstance: IFolderService | null = null;

  /**
   * Get or create a file service based on the provided configuration
   * Returns cached instance if available
   * @param config - Service configuration
   * @returns IFileService instance (local or remote)
   */
  static getFileService(config: ServiceConfig): IFileService {
    if (!this.fileServiceInstance) {
      this.fileServiceInstance = this.createFileService(config);
    }
    return this.fileServiceInstance;
  }

  /**
   * Get or create a folder service based on the provided configuration
   * Returns cached instance if available
   * @param config - Service configuration
   * @returns IFolderService instance (local or remote)
   */
  static getFolderService(config: ServiceConfig): IFolderService {
    if (!this.folderServiceInstance) {
      this.folderServiceInstance = this.createFolderService(config);
    }
    return this.folderServiceInstance;
  }

  /**
   * Reset cached service instances
   * Call this when switching databases or reinitializing
   */
  static reset(): void {
    this.fileServiceInstance = null;
    this.folderServiceInstance = null;
  }

  /**
   * Create a file service based on the provided configuration
   * @param config - Service configuration
   * @returns IFileService instance (local or remote)
   */
  private static createFileService(config: ServiceConfig): IFileService {
    if (config.mode === 'remote') {
      if (!config.apiUrl) {
        throw new Error('API URL is required for remote file service');
      }
      return new RemoteFileService(config.apiUrl, config.apiKey);
    }

    // Local mode
    if (!config.db || !config.dataDir) {
      throw new Error('Database and data directory are required for local file service');
    }
    return new LocalFileService(config.db, config.dataDir);
  }

  /**
   * Create a folder service based on the provided configuration
   * @param config - Service configuration
   * @returns IFolderService instance (local or remote)
   */
  private static createFolderService(config: ServiceConfig): IFolderService {
    if (config.mode === 'remote') {
      if (!config.apiUrl) {
        throw new Error('API URL is required for remote folder service');
      }
      return new RemoteFolderService(config.apiUrl, config.apiKey);
    }

    // Local mode
    if (!config.db) {
      throw new Error('Database is required for local folder service');
    }
    return new LocalFolderService(config.db);
  }

  /**
   * Create service configuration from environment variables
   * @param db - Database instance (for local mode)
   * @param dataDir - Data directory (for local mode)
   * @returns ServiceConfig
   */
  static createConfigFromEnv(
    db?: BetterSQLite3Database<typeof schema>,
    dataDir?: string
  ): ServiceConfig {
    const mode = (process.env.SERVICE_MODE || 'local') as 'local' | 'remote';

    return {
      mode,
      db,
      dataDir,
      apiUrl: process.env.REMOTE_API_URL,
      apiKey: process.env.REMOTE_API_KEY,
    };
  }
}
