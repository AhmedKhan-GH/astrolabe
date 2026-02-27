import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FileOperations } from './FileOperations';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../schema';
import type { File } from '../schema';

// Mock the schema module
vi.mock('../schema', () => ({
  files: {
    id: Symbol('id'),
    filename: Symbol('filename'),
    path: Symbol('path'),
    filetype: Symbol('filetype'),
    fileStorageType: Symbol('fileStorageType'),
    addedAt: Symbol('addedAt'),
  },
  folders: {
    id: Symbol('id'),
    name: Symbol('name'),
    parentId: Symbol('parentId'),
    isExpanded: Symbol('isExpanded'),
  },
  fileFolders: {
    fileId: Symbol('fileId'),
    folderId: Symbol('folderId'),
    addedAt: Symbol('addedAt'),
  },
}));

/**
 * Test suite for FileOperations
 *
 * This test suite validates the core business logic for file operations
 * at the data layer.
 */
describe('FileOperations', () => {
  let fileOps: FileOperations;
  let mockDb: BetterSQLite3Database<typeof schema>;

  // Mock helper functions
  const mockGetFolderById = vi.fn();
  const mockExpandAncestors = vi.fn();
  const mockConfirmCallback = vi.fn();

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();
    mockGetFolderById.mockClear();
    mockExpandAncestors.mockClear();
    mockConfirmCallback.mockClear();

    // Create a minimal mock database
    mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      values: vi.fn().mockReturnThis(),
      returning: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
    } as unknown as BetterSQLite3Database<typeof schema>;

    fileOps = new FileOperations(mockDb);
  });

  describe('getFolderIdsForFile', () => {
    it('should retrieve all folder IDs that a file is linked to via junction table', async () => {
      mockDb.select = vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([
            { folderId: 1 },
            { folderId: 2 },
            { folderId: 3 }
          ])
        })
      });

      const result = await fileOps.getFolderIdsForFile(1);
      expect(result).toEqual([1, 2, 3]);
    });

    it('should return empty array when file is not linked to any folders', async () => {
      mockDb.select = vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([])
        })
      });

      const result = await fileOps.getFolderIdsForFile(999);
      expect(result).toEqual([]);
    });
  });

  describe('isFileInFolder', () => {
    it('should return true when file-folder link exists in junction table', async () => {
      mockDb.select = vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([{ fileId: 1, folderId: 2 }])
          })
        })
      });

      const result = await fileOps.isFileInFolder(1, 2);
      expect(result).toBe(true);
    });

    it('should return false when file-folder link does not exist in junction table', async () => {
      mockDb.select = vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([])
          })
        })
      });

      const result = await fileOps.isFileInFolder(1, 2);
      expect(result).toBe(false);
    });
  });

  describe('getFileById', () => {
    it('should retrieve and return file record when querying by valid file ID', async () => {
      const mockFile: File = {
        id: 1,
        filename: 'test.txt',
        path: '/test.txt',
        filetype: 'text',
        fileStorageType: 'import',
        addedAt: null,
      };

      mockDb.select = vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([mockFile])
          })
        })
      });

      const result = await fileOps.getFileById(1);
      expect(result).toEqual(mockFile);
    });

    it('should return undefined when querying for non-existent file ID', async () => {
      mockDb.select = vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([])
          })
        })
      });

      const result = await fileOps.getFileById(999);
      expect(result).toBeUndefined();
    });
  });

  describe('importFile', () => {
    it('should create new file record and expand ancestors when importing unique file to non-root folder', async () => {
      const newFile: File = {
        id: 1,
        filename: 'new.txt',
        path: '/new.txt',
        filetype: 'text',
        fileStorageType: 'import',
        addedAt: null,
      };

      // No existing file found
      mockDb.select = vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([])
        })
      });

      mockDb.insert = vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([newFile])
        })
      });

      const result = await fileOps.importFile(
        'new.txt',
        '/new.txt',
        'text',
        1,
        'import',
        mockConfirmCallback,
        mockExpandAncestors
      );

      expect(result.isUpdate).toBe(false);
      expect(result.file).toEqual(newFile);
      expect(mockConfirmCallback).not.toHaveBeenCalled();
      expect(mockDb.insert).toHaveBeenCalledTimes(2); // Once for file, once for file_folders
      expect(mockExpandAncestors).toHaveBeenCalledWith(1);
    });

    it('should skip expanding ancestors when importing file to root folder (folderId 0)', async () => {
      const newFile: File = {
        id: 1,
        filename: 'new.txt',
        path: '/new.txt',
        filetype: 'text',
        fileStorageType: 'import',
        addedAt: null,
      };

      mockDb.select = vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([])
        })
      });

      mockDb.insert = vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([newFile])
        })
      });

      await fileOps.importFile(
        'new.txt',
        '/new.txt',
        'text',
        0,
        'import',
        mockConfirmCallback,
        mockExpandAncestors
      );

      expect(mockExpandAncestors).not.toHaveBeenCalled();
    });

    it('should reject import and throw error when file with same name already exists in target folder', async () => {
      const existingFile: File = {
        id: 1,
        filename: 'existing.txt',
        path: '/existing.txt',
        filetype: 'text',
        fileStorageType: 'import',
        addedAt: null,
      };

      // Mock finding existing file
      let selectCallCount = 0;
      mockDb.select = vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockImplementation(() => {
            selectCallCount++;
            // First call: getFileByFilenameAndStorageType finds the file
            if (selectCallCount === 1) {
              return Promise.resolve([existingFile]);
            }
            // Second call: isFileInFolder checks if file is already in folder
            return {
              limit: vi.fn().mockResolvedValue([{ fileId: 1, folderId: 1 }])
            };
          })
        })
      });

      await expect(
        fileOps.importFile(
          'existing.txt',
          '/existing.txt',
          'text',
          1,
          'import',
          mockConfirmCallback,
          mockExpandAncestors
        )
      ).rejects.toThrow('The file already exists in this folder');

      expect(mockConfirmCallback).not.toHaveBeenCalled();
    });

    it('should update existing file with new path and folder when user confirms duplicate file import', async () => {
      const existingFile: File = {
        id: 1,
        filename: 'existing.txt',
        path: '/old/path.txt',
        filetype: 'text',
        fileStorageType: 'import',
        addedAt: null,
      };

      let selectCallCount = 0;
      mockDb.select = vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockImplementation(() => {
            selectCallCount++;
            // First call: getFileByFilenameAndStorageType finds the file
            if (selectCallCount === 1) {
              return Promise.resolve([existingFile]);
            }
            // Second call: isFileInFolder checks if NOT already in folder
            return {
              limit: vi.fn().mockResolvedValue([]) // Not in folder yet
            };
          })
        })
      });

      mockDb.update = vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined)
        })
      });

      mockDb.insert = vi.fn().mockReturnValue({
        values: vi.fn().mockResolvedValue(undefined)
      });

      mockConfirmCallback.mockResolvedValue(true);

      const result = await fileOps.importFile(
        'existing.txt',
        '/new/path.txt',
        'text',
        1,
        'import',
        mockConfirmCallback,
        mockExpandAncestors
      );

      expect(result.isUpdate).toBe(true);
      expect(mockConfirmCallback).toHaveBeenCalledWith(existingFile);
      // Update is not called for import files (they use hash-based storage)
      expect(mockDb.insert).toHaveBeenCalled(); // Add file-folder link
      expect(mockExpandAncestors).toHaveBeenCalledWith(1);
    });

    it('should abort import without updating database when user cancels duplicate file confirmation', async () => {
      const existingFile: File = {
        id: 1,
        filename: 'existing.txt',
        path: '/existing.txt',
        filetype: 'text',
        fileStorageType: 'import',
        addedAt: null,
      };

      let selectCallCount = 0;
      mockDb.select = vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockImplementation(() => {
            selectCallCount++;
            // First call: getFileByFilenameAndStorageType finds the file
            if (selectCallCount === 1) {
              return Promise.resolve([existingFile]);
            }
            // Second call: isFileInFolder checks if NOT already in folder
            return {
              limit: vi.fn().mockResolvedValue([])
            };
          })
        })
      });

      mockConfirmCallback.mockResolvedValue(false);

      const result = await fileOps.importFile(
        'existing.txt',
        '/existing.txt',
        'text',
        1,
        'import',
        mockConfirmCallback,
        mockExpandAncestors
      );

      expect(result.cancelled).toBe(true);
      expect(result.isUpdate).toBe(false);
      expect(result.existingFile).toEqual(existingFile);
      expect(mockDb.update).not.toHaveBeenCalled();
    });
  });

  describe('moveFile', () => {
    it('should validate file exists and throw error when attempting to move non-existent file', async () => {
      mockDb.select = vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([])
          })
        })
      });

      mockGetFolderById.mockResolvedValue({ id: 1, name: 'Folder', parentId: 0, isExpanded: false, createdAt: null });

      await expect(
        fileOps.moveFile(999, 1, mockGetFolderById, mockExpandAncestors)
      ).rejects.toThrow('File not found');
    });

    it('should validate target folder exists and throw error when moving to non-existent folder', async () => {
      const mockFile: File = {
        id: 1,
        filename: 'test.txt',
        path: '/test.txt',
        filetype: 'text',
        fileStorageType: 'import',
        addedAt: null,
      };

      mockDb.select = vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([mockFile])
          })
        })
      });

      mockGetFolderById.mockResolvedValue(undefined);

      await expect(
        fileOps.moveFile(1, 999, mockGetFolderById, mockExpandAncestors)
      ).rejects.toThrow('Target folder not found');
    });

    it('should detect no-op move and throw error when file is already in target folder', async () => {
      const mockFile: File = {
        id: 1,
        filename: 'test.txt',
        path: '/test.txt',
        filetype: 'text',
        fileStorageType: 'import',
        addedAt: null,
      };

      let selectCallCount = 0;
      mockDb.select = vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockImplementation(() => {
            selectCallCount++;
            if (selectCallCount === 1) {
              // getFileById call
              return { limit: vi.fn().mockResolvedValue([mockFile]) };
            }
            // getFolderIdsForFile call
            return Promise.resolve([{ folderId: 1 }]);
          })
        })
      });

      mockGetFolderById.mockResolvedValue({ id: 1, name: 'Folder', parentId: 0, isExpanded: false, createdAt: null });

      await expect(
        fileOps.moveFile(1, 1, mockGetFolderById, mockExpandAncestors)
      ).rejects.toThrow('File is already in this location');
    });

    it('should remove all existing folder links and create new link when moving file to different folder', async () => {
      const mockFile: File = {
        id: 1,
        filename: 'test.txt',
        path: '/test.txt',
        filetype: 'text',
        fileStorageType: 'import',
        addedAt: null,
      };

      let selectCallCount = 0;
      mockDb.select = vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockImplementation(() => {
            selectCallCount++;
            if (selectCallCount === 1) {
              // getFileById call
              return { limit: vi.fn().mockResolvedValue([mockFile]) };
            }
            // getFolderIdsForFile call
            return Promise.resolve([{ folderId: 1 }]);
          })
        })
      });

      mockDb.delete = vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined)
      });

      mockDb.insert = vi.fn().mockReturnValue({
        values: vi.fn().mockResolvedValue(undefined)
      });

      mockGetFolderById.mockResolvedValue({ id: 2, name: 'Folder', parentId: 0, isExpanded: false, createdAt: null });

      await fileOps.moveFile(1, 2, mockGetFolderById, mockExpandAncestors);

      expect(mockDb.delete).toHaveBeenCalled(); // Remove all folder links
      expect(mockDb.insert).toHaveBeenCalled(); // Add new folder link
      expect(mockExpandAncestors).toHaveBeenCalledWith(2);
    });

    it('should allow moving file to root folder (folderId 0) without ancestor expansion', async () => {
      const mockFile: File = {
        id: 1,
        filename: 'test.txt',
        path: '/test.txt',
        filetype: 'text',
        fileStorageType: 'import',
        addedAt: null,
      };

      let selectCallCount = 0;
      mockDb.select = vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockImplementation(() => {
            selectCallCount++;
            if (selectCallCount === 1) {
              // getFileById call
              return { limit: vi.fn().mockResolvedValue([mockFile]) };
            }
            // getFolderIdsForFile call
            return Promise.resolve([{ folderId: 1 }]);
          })
        })
      });

      mockDb.delete = vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined)
      });

      mockDb.insert = vi.fn().mockReturnValue({
        values: vi.fn().mockResolvedValue(undefined)
      });

      await fileOps.moveFile(1, 0, mockGetFolderById, mockExpandAncestors);

      expect(mockDb.delete).toHaveBeenCalled();
      expect(mockDb.insert).toHaveBeenCalled();
      expect(mockExpandAncestors).not.toHaveBeenCalled();
    });
  });

  describe('addFile', () => {
    it('should validate file exists and throw error when adding non-existent file to folder', async () => {
      mockDb.select = vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([])
          })
        })
      });

      mockGetFolderById.mockResolvedValue({ id: 1, name: 'Folder', parentId: 0, isExpanded: false, createdAt: null });

      await expect(
        fileOps.addFile(999, 1, mockGetFolderById, mockExpandAncestors)
      ).rejects.toThrow('File not found');
    });

    it('should validate target folder exists and throw error when adding to non-existent folder', async () => {
      const mockFile: File = {
        id: 1,
        filename: 'test.txt',
        path: '/test.txt',
        filetype: 'text',
        fileStorageType: 'import',
        addedAt: null,
      };

      mockDb.select = vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([mockFile])
          })
        })
      });

      mockGetFolderById.mockResolvedValue(undefined);

      await expect(
        fileOps.addFile(1, 999, mockGetFolderById, mockExpandAncestors)
      ).rejects.toThrow('Folder not found');
    });

    it('should prevent duplicate folder membership and throw error when file already linked to target folder', async () => {
      const mockFile: File = {
        id: 1,
        filename: 'test.txt',
        path: '/test.txt',
        filetype: 'text',
        fileStorageType: 'import',
        addedAt: null,
      };

      let selectCallCount = 0;
      mockDb.select = vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockImplementation(() => {
            selectCallCount++;
            if (selectCallCount === 1) {
              // getFileById call
              return { limit: vi.fn().mockResolvedValue([mockFile]) };
            }
            // isFileInFolder call - file is already in folder
            return { limit: vi.fn().mockResolvedValue([{ fileId: 1, folderId: 1 }]) };
          })
        })
      });

      mockGetFolderById.mockResolvedValue({ id: 1, name: 'Folder', parentId: 0, isExpanded: false, createdAt: null });

      await expect(
        fileOps.addFile(1, 1, mockGetFolderById, mockExpandAncestors)
      ).rejects.toThrow('The file already exists in this folder');
    });

    it('should create file-folder link in junction table and expand ancestors when adding file to additional folder', async () => {
      const mockFile: File = {
        id: 1,
        filename: 'test.txt',
        path: '/test.txt',
        filetype: 'text',
        fileStorageType: 'import',
        addedAt: null,
      };

      let selectCallCount = 0;
      mockDb.select = vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockImplementation(() => {
            selectCallCount++;
            if (selectCallCount === 1) {
              // getFileById call
              return { limit: vi.fn().mockResolvedValue([mockFile]) };
            }
            // isFileInFolder call - not in folder yet
            return { limit: vi.fn().mockResolvedValue([]) };
          })
        })
      });

      mockDb.insert = vi.fn().mockReturnValue({
        values: vi.fn().mockResolvedValue(undefined)
      });

      mockGetFolderById.mockResolvedValue({ id: 2, name: 'Folder', parentId: 0, isExpanded: false, createdAt: null });

      await fileOps.addFile(1, 2, mockGetFolderById, mockExpandAncestors);

      expect(mockDb.insert).toHaveBeenCalled();
      expect(mockExpandAncestors).toHaveBeenCalledWith(2);
    });

    it('should allow adding file to root folder (folderId 0) without folder validation or ancestor expansion', async () => {
      const mockFile: File = {
        id: 1,
        filename: 'test.txt',
        path: '/test.txt',
        filetype: 'text',
        fileStorageType: 'import',
        addedAt: null,
      };

      let selectCallCount = 0;
      mockDb.select = vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockImplementation(() => {
            selectCallCount++;
            if (selectCallCount === 1) {
              // getFileById call
              return { limit: vi.fn().mockResolvedValue([mockFile]) };
            }
            // isFileInFolder call
            return { limit: vi.fn().mockResolvedValue([]) };
          })
        })
      });

      mockDb.insert = vi.fn().mockReturnValue({
        values: vi.fn().mockResolvedValue(undefined)
      });

      await fileOps.addFile(1, 0, mockGetFolderById, mockExpandAncestors);

      expect(mockGetFolderById).not.toHaveBeenCalled();
      expect(mockDb.insert).toHaveBeenCalled();
      expect(mockExpandAncestors).not.toHaveBeenCalled();
    });
  });

  describe('removeFileFromFolder', () => {
    it('should validate file exists and throw error when removing link from non-existent file', async () => {
      mockDb.select = vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([])
          })
        })
      });

      await expect(
        fileOps.removeFileFromFolder(999, 1)
      ).rejects.toThrow('File not found');
    });

    it('should delete file-folder link from junction table when removing file from folder', async () => {
      const mockFile: File = {
        id: 1,
        filename: 'test.txt',
        path: '/test.txt',
        filetype: 'text',
        fileStorageType: 'import',
        addedAt: null,
      };

      mockDb.select = vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([mockFile])
          })
        })
      });

      mockDb.delete = vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined)
      });

      await fileOps.removeFileFromFolder(1, 2);

      expect(mockDb.delete).toHaveBeenCalled();
    });

    it('should gracefully handle removing file from folder when file is not linked to that folder (no-op delete)', async () => {
      const mockFile: File = {
        id: 1,
        filename: 'test.txt',
        path: '/test.txt',
        filetype: 'text',
        fileStorageType: 'import',
        addedAt: null,
      };

      mockDb.select = vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([mockFile])
          })
        })
      });

      mockDb.delete = vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined)
      });

      await fileOps.removeFileFromFolder(1, 2);

      expect(mockDb.delete).toHaveBeenCalled(); // Still executes delete, just won't match any rows
    });
  });

  describe('deleteFile', () => {
    it('should permanently remove file record from database and cascade delete junction table entries', async () => {
      const mockFile: File = {
        id: 1,
        filename: 'test.txt',
        path: '/test.txt',
        filetype: 'text',
        fileStorageType: 'import',
        addedAt: null,
      };

      mockDb.select = vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([mockFile])
          })
        })
      });

      mockDb.delete = vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined)
      });

      const result = await fileOps.deleteFile(1);

      expect(result).toEqual(mockFile);
      expect(mockDb.delete).toHaveBeenCalled();
    });

    it('should skip deletion and return undefined when attempting to delete non-existent file', async () => {
      mockDb.select = vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([])
          })
        })
      });

      mockDb.delete = vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined)
      });

      const result = await fileOps.deleteFile(999);

      expect(result).toBeUndefined();
      expect(mockDb.delete).not.toHaveBeenCalled();
    });
  });

  describe('addFile', () => {
    it('should throw error when adding non-existent file to folder and validate before database operations', async () => {
      // Mock file not found
      mockDb.select = vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([])
          })
        })
      });

      mockGetFolderById.mockResolvedValue({ id: 1, name: 'Folder', parentId: 0, isExpanded: false, createdAt: null });

      await expect(
        fileOps.addFile(999, 1, mockGetFolderById, mockExpandAncestors)
      ).rejects.toThrow('File not found');

      // Verify no database write operations occurred
      expect(mockDb.insert).not.toHaveBeenCalled();
    });

    it('should throw error when adding file to non-existent folder and validate before database operations', async () => {
      const mockFile: File = {
        id: 1,
        filename: 'test.txt',
        path: '/test.txt',
        filetype: 'text',
        fileStorageType: 'import',
        addedAt: null,
      };

      // Mock file exists
      mockDb.select = vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([mockFile])
          })
        })
      });

      mockGetFolderById.mockResolvedValue(undefined);

      await expect(
        fileOps.addFile(1, 999, mockGetFolderById, mockExpandAncestors)
      ).rejects.toThrow('Folder not found');

      // Verify no database write operations occurred
      expect(mockDb.insert).not.toHaveBeenCalled();
    });

    it('should throw error when file is already in the target folder and validate before database operations', async () => {
      const mockFile: File = {
        id: 1,
        filename: 'test.txt',
        path: '/test.txt',
        filetype: 'text',
        fileStorageType: 'import',
        addedAt: null,
      };

      let selectCallCount = 0;
      mockDb.select = vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockImplementation(() => {
            selectCallCount++;
            // First call: getFileById
            if (selectCallCount === 1) {
              return {
                limit: vi.fn().mockResolvedValue([mockFile])
              };
            }
            // Second call: isFileInFolder (file already in folder)
            return {
              limit: vi.fn().mockResolvedValue([{ fileId: 1, folderId: 2 }])
            };
          })
        })
      });

      mockGetFolderById.mockResolvedValue({ id: 2, name: 'Folder', parentId: 0, isExpanded: false, createdAt: null });

      await expect(
        fileOps.addFile(1, 2, mockGetFolderById, mockExpandAncestors)
      ).rejects.toThrow('The file already exists in this folder');

      // Verify no database write operations occurred
      expect(mockDb.insert).not.toHaveBeenCalled();
    });

    it('should allow adding file to root folder (folderId 0) without checking if folder exists', async () => {
      const mockFile: File = {
        id: 1,
        filename: 'test.txt',
        path: '/test.txt',
        filetype: 'text',
        fileStorageType: 'import',
        addedAt: null,
      };

      let selectCallCount = 0;
      mockDb.select = vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockImplementation(() => {
            selectCallCount++;
            // First call: getFileById
            if (selectCallCount === 1) {
              return {
                limit: vi.fn().mockResolvedValue([mockFile])
              };
            }
            // Second call: isFileInFolder (file not in folder)
            return {
              limit: vi.fn().mockResolvedValue([])
            };
          })
        })
      });

      mockDb.insert = vi.fn().mockReturnValue({
        values: vi.fn().mockResolvedValue(undefined)
      });

      await fileOps.addFile(1, 0, mockGetFolderById, mockExpandAncestors);

      expect(mockGetFolderById).not.toHaveBeenCalled(); // Root folder doesn't need validation
      expect(mockDb.insert).toHaveBeenCalled();
      expect(mockExpandAncestors).not.toHaveBeenCalled(); // No expansion for root
    });

    it('should successfully add file to folder when file and folder exist and file is not already in folder', async () => {
      const mockFile: File = {
        id: 1,
        filename: 'test.txt',
        path: '/test.txt',
        filetype: 'text',
        fileStorageType: 'import',
        addedAt: null,
      };

      let selectCallCount = 0;
      mockDb.select = vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockImplementation(() => {
            selectCallCount++;
            // First call: getFileById
            if (selectCallCount === 1) {
              return {
                limit: vi.fn().mockResolvedValue([mockFile])
              };
            }
            // Second call: isFileInFolder (file not in folder)
            return {
              limit: vi.fn().mockResolvedValue([])
            };
          })
        })
      });

      mockDb.insert = vi.fn().mockReturnValue({
        values: vi.fn().mockResolvedValue(undefined)
      });

      mockGetFolderById.mockResolvedValue({ id: 2, name: 'Folder', parentId: 0, isExpanded: false, createdAt: null });

      await fileOps.addFile(1, 2, mockGetFolderById, mockExpandAncestors);

      expect(mockGetFolderById).toHaveBeenCalledWith(2);
      expect(mockDb.insert).toHaveBeenCalled();
      expect(mockExpandAncestors).toHaveBeenCalledWith(2);
    });

    it('should expand ancestors when adding file to non-root folder', async () => {
      const mockFile: File = {
        id: 1,
        filename: 'test.txt',
        path: '/test.txt',
        filetype: 'text',
        fileStorageType: 'import',
        addedAt: null,
      };

      let selectCallCount = 0;
      mockDb.select = vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockImplementation(() => {
            selectCallCount++;
            // First call: getFileById
            if (selectCallCount === 1) {
              return {
                limit: vi.fn().mockResolvedValue([mockFile])
              };
            }
            // Second call: isFileInFolder
            return {
              limit: vi.fn().mockResolvedValue([])
            };
          })
        })
      });

      mockDb.insert = vi.fn().mockReturnValue({
        values: vi.fn().mockResolvedValue(undefined)
      });

      mockGetFolderById.mockResolvedValue({ id: 5, name: 'Folder', parentId: 2, isExpanded: false, createdAt: null });

      await fileOps.addFile(1, 5, mockGetFolderById, mockExpandAncestors);

      expect(mockExpandAncestors).toHaveBeenCalledWith(5);
      expect(mockExpandAncestors).toHaveBeenCalledTimes(1);
    });

    it('should not expand ancestors when adding file to root folder (folderId 0)', async () => {
      const mockFile: File = {
        id: 1,
        filename: 'test.txt',
        path: '/test.txt',
        filetype: 'text',
        fileStorageType: 'import',
        addedAt: null,
      };

      let selectCallCount = 0;
      mockDb.select = vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockImplementation(() => {
            selectCallCount++;
            // First call: getFileById
            if (selectCallCount === 1) {
              return {
                limit: vi.fn().mockResolvedValue([mockFile])
              };
            }
            // Second call: isFileInFolder
            return {
              limit: vi.fn().mockResolvedValue([])
            };
          })
        })
      });

      mockDb.insert = vi.fn().mockReturnValue({
        values: vi.fn().mockResolvedValue(undefined)
      });

      await fileOps.addFile(1, 0, mockGetFolderById, mockExpandAncestors);

      expect(mockExpandAncestors).not.toHaveBeenCalled();
    });

    it('should allow file to exist in multiple folders simultaneously', async () => {
      const mockFile: File = {
        id: 1,
        filename: 'test.txt',
        path: '/test.txt',
        filetype: 'text',
        fileStorageType: 'import',
        addedAt: null,
      };

      let selectCallCount = 0;
      mockDb.select = vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockImplementation(() => {
            selectCallCount++;
            // First call: getFileById
            if (selectCallCount === 1) {
              return {
                limit: vi.fn().mockResolvedValue([mockFile])
              };
            }
            // Second call: isFileInFolder (file not in folder 3)
            return {
              limit: vi.fn().mockResolvedValue([])
            };
          })
        })
      });

      mockDb.insert = vi.fn().mockReturnValue({
        values: vi.fn().mockResolvedValue(undefined)
      });

      mockGetFolderById.mockResolvedValue({ id: 3, name: 'Folder3', parentId: 0, isExpanded: false, createdAt: null });

      // Add file to folder 3 (file might already be in folders 1 and 2)
      await fileOps.addFile(1, 3, mockGetFolderById, mockExpandAncestors);

      expect(mockDb.insert).toHaveBeenCalled();
      expect(mockExpandAncestors).toHaveBeenCalledWith(3);
    });
  });
});
