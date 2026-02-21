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
    folderIds: Symbol('folderIds'),
    fileStorageType: Symbol('fileStorageType'),
    addedAt: Symbol('addedAt'),
  },
  folders: {
    id: Symbol('id'),
    name: Symbol('name'),
    parentId: Symbol('parentId'),
    isExpanded: Symbol('isExpanded'),
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

  describe('parseFolderIds', () => {
    it('should parse valid JSON array', () => {
      const result = fileOps.parseFolderIds('[1,2,3]');
      expect(result).toEqual([1, 2, 3]);
    });

    it('should return empty array for null', () => {
      const result = fileOps.parseFolderIds(null);
      expect(result).toEqual([]);
    });

    it('should return empty array for invalid JSON', () => {
      const result = fileOps.parseFolderIds('invalid json');
      expect(result).toEqual([]);
    });

    it('should return empty array for non-array JSON', () => {
      const result = fileOps.parseFolderIds('{"key": "value"}');
      expect(result).toEqual([]);
    });
  });

  describe('getFileById', () => {
    it('should return file when found', async () => {
      const mockFile: File = {
        id: 1,
        filename: 'test.txt',
        path: '/test.txt',
        filetype: 'text',
        folderIds: '[0]',
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

    it('should return undefined when file not found', async () => {
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
    it('should create new file when no duplicate exists', async () => {
      const newFile: File = {
        id: 1,
        filename: 'new.txt',
        path: '/new.txt',
        filetype: 'text',
        folderIds: '[1]',
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
      expect(mockExpandAncestors).toHaveBeenCalledWith(1);
    });

    it('should not expand ancestors when adding to root folder', async () => {
      const newFile: File = {
        id: 1,
        filename: 'new.txt',
        path: '/new.txt',
        filetype: 'text',
        folderIds: '[0]',
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

    it('should throw error when file already exists in target folder', async () => {
      const existingFile: File = {
        id: 1,
        filename: 'existing.txt',
        path: '/existing.txt',
        filetype: 'text',
        folderIds: '[1]',
        fileStorageType: 'import',
        addedAt: null,
      };

      mockDb.select = vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([existingFile])
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

    it('should update existing file when user confirms', async () => {
      const existingFile: File = {
        id: 1,
        filename: 'existing.txt',
        path: '/old/path.txt',
        filetype: 'text',
        folderIds: '[2]',
        fileStorageType: 'import',
        addedAt: null,
      };

      mockDb.select = vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([existingFile])
        })
      });

      mockDb.update = vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined)
        })
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
      expect(mockDb.update).toHaveBeenCalled();
      expect(mockExpandAncestors).toHaveBeenCalledWith(1);
    });

    it('should return cancelled when user cancels update', async () => {
      const existingFile: File = {
        id: 1,
        filename: 'existing.txt',
        path: '/existing.txt',
        filetype: 'text',
        folderIds: '[2]',
        fileStorageType: 'import',
        addedAt: null,
      };

      mockDb.select = vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([existingFile])
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
    it('should throw error when file not found', async () => {
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

    it('should throw error when target folder not found', async () => {
      const mockFile: File = {
        id: 1,
        filename: 'test.txt',
        path: '/test.txt',
        filetype: 'text',
        folderIds: '[0]',
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

    it('should throw error when file is already in target location', async () => {
      const mockFile: File = {
        id: 1,
        filename: 'test.txt',
        path: '/test.txt',
        filetype: 'text',
        folderIds: '[1]',
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

      mockGetFolderById.mockResolvedValue({ id: 1, name: 'Folder', parentId: 0, isExpanded: false, createdAt: null });

      await expect(
        fileOps.moveFile(1, 1, mockGetFolderById, mockExpandAncestors)
      ).rejects.toThrow('File is already in this location');
    });

    it('should move file to different folder', async () => {
      const mockFile: File = {
        id: 1,
        filename: 'test.txt',
        path: '/test.txt',
        filetype: 'text',
        folderIds: '[1]',
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

      mockDb.update = vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined)
        })
      });

      mockGetFolderById.mockResolvedValue({ id: 2, name: 'Folder', parentId: 0, isExpanded: false, createdAt: null });

      await fileOps.moveFile(1, 2, mockGetFolderById, mockExpandAncestors);

      expect(mockDb.update).toHaveBeenCalled();
      expect(mockExpandAncestors).toHaveBeenCalledWith(2);
    });

    it('should allow moving to root folder', async () => {
      const mockFile: File = {
        id: 1,
        filename: 'test.txt',
        path: '/test.txt',
        filetype: 'text',
        folderIds: '[1]',
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

      mockDb.update = vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined)
        })
      });

      await fileOps.moveFile(1, 0, mockGetFolderById, mockExpandAncestors);

      expect(mockDb.update).toHaveBeenCalled();
      expect(mockExpandAncestors).not.toHaveBeenCalled();
    });
  });

  describe('addFileToFolder', () => {
    it('should throw error when file not found', async () => {
      mockDb.select = vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([])
          })
        })
      });

      mockGetFolderById.mockResolvedValue({ id: 1, name: 'Folder', parentId: 0, isExpanded: false, createdAt: null });

      await expect(
        fileOps.addFileToFolder(999, 1, mockGetFolderById, mockExpandAncestors)
      ).rejects.toThrow('File not found');
    });

    it('should throw error when folder not found', async () => {
      const mockFile: File = {
        id: 1,
        filename: 'test.txt',
        path: '/test.txt',
        filetype: 'text',
        folderIds: '[0]',
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
        fileOps.addFileToFolder(1, 999, mockGetFolderById, mockExpandAncestors)
      ).rejects.toThrow('Folder not found');
    });

    it('should throw error when file already in target folder', async () => {
      const mockFile: File = {
        id: 1,
        filename: 'test.txt',
        path: '/test.txt',
        filetype: 'text',
        folderIds: '[1,2]',
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

      mockGetFolderById.mockResolvedValue({ id: 1, name: 'Folder', parentId: 0, isExpanded: false, createdAt: null });

      await expect(
        fileOps.addFileToFolder(1, 1, mockGetFolderById, mockExpandAncestors)
      ).rejects.toThrow('The file already exists in this folder');
    });

    it('should add file to folder', async () => {
      const mockFile: File = {
        id: 1,
        filename: 'test.txt',
        path: '/test.txt',
        filetype: 'text',
        folderIds: '[1]',
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

      mockDb.update = vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined)
        })
      });

      mockGetFolderById.mockResolvedValue({ id: 2, name: 'Folder', parentId: 0, isExpanded: false, createdAt: null });

      await fileOps.addFileToFolder(1, 2, mockGetFolderById, mockExpandAncestors);

      expect(mockDb.update).toHaveBeenCalled();
      expect(mockExpandAncestors).toHaveBeenCalledWith(2);
    });

    it('should allow adding file to root folder', async () => {
      const mockFile: File = {
        id: 1,
        filename: 'test.txt',
        path: '/test.txt',
        filetype: 'text',
        folderIds: '[1]',
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

      mockDb.update = vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined)
        })
      });

      await fileOps.addFileToFolder(1, 0, mockGetFolderById, mockExpandAncestors);

      expect(mockGetFolderById).not.toHaveBeenCalled();
      expect(mockDb.update).toHaveBeenCalled();
      expect(mockExpandAncestors).not.toHaveBeenCalled();
    });
  });

  describe('removeFileFromFolder', () => {
    it('should throw error when file not found', async () => {
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

    it('should remove file from folder', async () => {
      const mockFile: File = {
        id: 1,
        filename: 'test.txt',
        path: '/test.txt',
        filetype: 'text',
        folderIds: '[1,2,3]',
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

      mockDb.update = vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined)
        })
      });

      await fileOps.removeFileFromFolder(1, 2);

      expect(mockDb.update).toHaveBeenCalled();
    });

    it('should handle removing file from folder it is not in', async () => {
      const mockFile: File = {
        id: 1,
        filename: 'test.txt',
        path: '/test.txt',
        filetype: 'text',
        folderIds: '[1,3]',
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

      mockDb.update = vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined)
        })
      });

      await fileOps.removeFileFromFolder(1, 2);

      expect(mockDb.update).toHaveBeenCalled();
    });
  });

  describe('deleteFile', () => {
    it('should delete file when it exists', async () => {
      const mockFile: File = {
        id: 1,
        filename: 'test.txt',
        path: '/test.txt',
        filetype: 'text',
        folderIds: '[0]',
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

    it('should return undefined when file does not exist', async () => {
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
});
