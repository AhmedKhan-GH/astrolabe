import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FolderOperations } from './FolderOperations';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../schema';
import { ERROR_MESSAGES } from '../../config/constants';

// Mock the logger module
vi.mock('../../utils/logger', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock the schema module
vi.mock('../schema', () => ({
  folders: {
    id: Symbol('id'),
    name: Symbol('name'),
    parentId: Symbol('parentId'),
    isExpanded: Symbol('isExpanded'),
  },
  files: {
    id: Symbol('id'),
    filename: Symbol('filename'),
    path: Symbol('path'),
    filetype: Symbol('filetype'),
    folderIds: Symbol('folderIds'),
  },
}));

/**
 * Test suite for FolderOperations
 *
 * This test suite validates that the core business logic prevents invalid
 * operations at the data layer, independent of any UI or interface constraints.
 *
 * These tests ensure that even if the interface layer allowed such operations,
 * the data structure protection would prevent them from executing.
 */
describe('FolderOperations', () => {
  let folderOps: FolderOperations;
  let mockDb: BetterSQLite3Database<typeof schema>;

  // Mock helper functions used by move/remove/delete operations
  const mockParseFolderIds = vi.fn((json: string | null) => {
    if (!json) return [];
    return JSON.parse(json);
  });

  const mockUpdateFileFolderIds = vi.fn(async () => {
    // Mock implementation
  });

  const mockDeleteFile = vi.fn(async () => {
    // Mock implementation
  });

  const mockGetAllFiles = vi.fn(async (): Promise<Array<{
    id: number;
    filename: string;
    path: string;
    filetype: string | null;
    folderIds: string | null;
    fileStorageType: string;
    addedAt: Date | null;
  }>> => {
    return [];
  });

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();
    mockParseFolderIds.mockClear();
    mockUpdateFileFolderIds.mockClear();
    mockDeleteFile.mockClear();
    mockGetAllFiles.mockClear();

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

    folderOps = new FolderOperations(mockDb);
  });

  describe('rootFolderProtection', () => {
    it('should throw error when moving root folder and validate before database operations', async () => {
      const destinations = [0, 1, 5, 10, 100, 999, -1, -999];

      for (const destId of destinations) {
        await expect(
          folderOps.moveFolder(0, destId, mockParseFolderIds, mockUpdateFileFolderIds, mockGetAllFiles)
        ).rejects.toThrow(ERROR_MESSAGES.CANNOT_MOVE_DIRECTORY);
      }

      // Verify no database operations occurred
      expect(mockDb.select).not.toHaveBeenCalled();
      expect(mockDb.update).not.toHaveBeenCalled();
      expect(mockDb.delete).not.toHaveBeenCalled();
    });

    it('should throw error when removing root folder and validate before database operations', async () => {
      await expect(
        folderOps.removeFolder(0, mockParseFolderIds, mockUpdateFileFolderIds, mockGetAllFiles)
      ).rejects.toThrow(ERROR_MESSAGES.CANNOT_REMOVE_DIRECTORY);

      // Verify no database operations occurred
      expect(mockDb.select).not.toHaveBeenCalled();
      expect(mockDb.update).not.toHaveBeenCalled();
      expect(mockDb.delete).not.toHaveBeenCalled();
    });

    it('should throw error when deleting root folder and validate before database operations', async () => {
      await expect(
        folderOps.deleteFolder(0, mockParseFolderIds, mockDeleteFile, mockUpdateFileFolderIds, mockGetAllFiles)
      ).rejects.toThrow(ERROR_MESSAGES.CANNOT_REMOVE_DIRECTORY);

      // Verify no database operations occurred
      expect(mockDb.select).not.toHaveBeenCalled();
      expect(mockDb.update).not.toHaveBeenCalled();
      expect(mockDb.delete).not.toHaveBeenCalled();
      expect(mockDeleteFile).not.toHaveBeenCalled();
    });

    it('should recognize 0 and only 0 as the root folder ID', async () => {
      await expect(
        folderOps.moveFolder(0, 1, mockParseFolderIds, mockUpdateFileFolderIds, mockGetAllFiles)
      ).rejects.toThrow(ERROR_MESSAGES.CANNOT_MOVE_DIRECTORY);

      mockDb.select = vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([{
              id: 1,
              name: 'TestFolder',
              parentId: 0,
              isExpanded: false,
              createdAt: null,
            }])
          })
        })
      });

      try {
        await folderOps.moveFolder(1, 2, mockParseFolderIds, mockUpdateFileFolderIds, mockGetAllFiles);
      } catch (error) {
        if (error instanceof Error) {
          expect(error.message).not.toBe(ERROR_MESSAGES.CANNOT_MOVE_DIRECTORY);
        }
      }
    });
  });

  describe('createFolder', () => {
    it('should throw error when creating folder with empty or whitespace-only name and validate before database operations', async () => {
      await expect(folderOps.createFolder('', 1)).rejects.toThrow('Folder name cannot be empty');
      await expect(folderOps.createFolder('   ', 1)).rejects.toThrow('Folder name cannot be empty');
      await expect(folderOps.createFolder('\t\n  ', 1)).rejects.toThrow('Folder name cannot be empty');

      // Verify no database operations occurred
      expect(mockDb.select).not.toHaveBeenCalled();
      expect(mockDb.insert).not.toHaveBeenCalled();
    });

    it('should throw error when creating folder with duplicate name in same parent and validate before database operations', async () => {
      const parentId = 1;
      const folderName = 'ExistingFolder';

      mockDb.select = vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([
            { id: 10, name: folderName, parentId: parentId, isExpanded: false, createdAt: null }
          ])
        })
      });

      await expect(
        folderOps.createFolder(folderName, parentId)
      ).rejects.toThrow('A folder with this name already exists at this level');

      // Verify insert did not occur (select is expected for duplicate check)
      expect(mockDb.insert).not.toHaveBeenCalled();
    });

    it('should create folder with valid name and allow same name in different parent', async () => {
      const folderName = 'TestFolder';
      const parentId1 = 1;
      const parentId2 = 2;

      mockDb.select = vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([])
        })
      });

      mockDb.insert = vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([
            { id: 30, name: folderName, parentId: parentId2, isExpanded: false, createdAt: null }
          ])
        })
      });

      const expandAncestorFoldersSpy = vi.spyOn(folderOps, 'expandAncestorFolders').mockResolvedValue(undefined);

      const result1 = await folderOps.createFolder(folderName, parentId1);
      expect(result1.name).toBe(folderName);
      expect(result1.parentId).toBe(parentId2);

      const result2 = await folderOps.createFolder(folderName, parentId2);
      expect(result2.name).toBe(folderName);

      expandAncestorFoldersSpy.mockRestore();
    });
  });

  describe('moveFolder', () => {
    it('should throw error when moving folder to itself and validate before database operations', async () => {
      await expect(
        folderOps.moveFolder(5, 5, mockParseFolderIds, mockUpdateFileFolderIds, mockGetAllFiles)
      ).rejects.toThrow('Cannot move folder to itself');

      // Verify no database operations occurred
      expect(mockDb.select).not.toHaveBeenCalled();
      expect(mockDb.update).not.toHaveBeenCalled();
      expect(mockDb.delete).not.toHaveBeenCalled();
    });

    it('should throw error when moving folder to its own descendant and validate before database operations', async () => {
      const getFolderByIdSpy = vi.spyOn(folderOps, 'getFolderById').mockResolvedValue({
        id: 1,
        name: 'Folder',
        parentId: 0,
        isExpanded: false,
        createdAt: null,
      });

      const isDescendantOfSpy = vi.spyOn(folderOps as unknown as { isDescendantOf: (folderId: number, targetId: number) => Promise<boolean> }, 'isDescendantOf').mockResolvedValue(true);

      await expect(
        folderOps.moveFolder(1, 10, mockParseFolderIds, mockUpdateFileFolderIds, mockGetAllFiles)
      ).rejects.toThrow('Cannot move folder to its own descendant');

      // Verify no database operations occurred
      expect(mockDb.update).not.toHaveBeenCalled();
      expect(mockDb.delete).not.toHaveBeenCalled();

      getFolderByIdSpy.mockRestore();
      isDescendantOfSpy.mockRestore();
    });

    it('should throw error when moving non-existent folder and validate before database operations', async () => {
      const getFolderByIdSpy = vi.spyOn(folderOps, 'getFolderById').mockResolvedValue(undefined);

      await expect(
        folderOps.moveFolder(999, 1, mockParseFolderIds, mockUpdateFileFolderIds, mockGetAllFiles)
      ).rejects.toThrow('Folder not found');

      // Verify no database operations occurred
      expect(mockDb.select).not.toHaveBeenCalled();
      expect(mockDb.update).not.toHaveBeenCalled();
      expect(mockDb.delete).not.toHaveBeenCalled();

      getFolderByIdSpy.mockRestore();
    });

    it('should throw error when moving folder to its current parent and validate before database operations', async () => {
      const folderId = 5;
      const currentParentId = 10;

      const getFolderByIdSpy = vi.spyOn(folderOps, 'getFolderById').mockResolvedValue({
        id: folderId,
        name: 'Folder',
        parentId: currentParentId,
        isExpanded: false,
        createdAt: null,
      });

      await expect(
        folderOps.moveFolder(folderId, currentParentId, mockParseFolderIds, mockUpdateFileFolderIds, mockGetAllFiles)
      ).rejects.toThrow('Folder is already in this location');

      // Verify no database operations occurred
      expect(mockDb.update).not.toHaveBeenCalled();
      expect(mockDb.delete).not.toHaveBeenCalled();

      getFolderByIdSpy.mockRestore();
    });

    it('should throw error when moving to non-existent parent folder and validate before database operations', async () => {
      const folderId = 5;
      const nonExistentParentId = 999;

      const getFolderByIdSpy = vi.spyOn(folderOps, 'getFolderById')
        .mockResolvedValueOnce({ id: folderId, name: 'Folder', parentId: 0, isExpanded: false, createdAt: null })
        .mockResolvedValueOnce(undefined);

      await expect(
        folderOps.moveFolder(folderId, nonExistentParentId, mockParseFolderIds, mockUpdateFileFolderIds, mockGetAllFiles)
      ).rejects.toThrow();

      // Verify no database operations occurred
      expect(mockDb.update).not.toHaveBeenCalled();
      expect(mockDb.delete).not.toHaveBeenCalled();

      getFolderByIdSpy.mockRestore();
    });

    it('should move folder to different parent and update parentId', async () => {
      const folderId = 5;
      const oldParentId = 1;
      const newParentId = 2;

      const getFolderByIdSpy = vi.spyOn(folderOps, 'getFolderById').mockResolvedValue({
        id: folderId,
        name: 'Folder',
        parentId: oldParentId,
        isExpanded: false,
        createdAt: null,
      });

      const isDescendantOfSpy = vi.spyOn(folderOps as unknown as { isDescendantOf: (folderId: number, targetId: number) => Promise<boolean> }, 'isDescendantOf').mockResolvedValue(false);
      const getFolderByNameAndParentSpy = vi.spyOn(folderOps as unknown as { getFolderByNameAndParent: (name: string, parentId: number) => Promise<unknown> }, 'getFolderByNameAndParent').mockResolvedValue(undefined);

      let capturedUpdate: { parentId: number } | null = null;
      mockDb.update = vi.fn().mockReturnValue({
        set: vi.fn((values: { parentId: number }) => {
          capturedUpdate = values;
          return {
            where: vi.fn().mockResolvedValue(undefined)
          };
        })
      });

      await folderOps.moveFolder(folderId, newParentId, mockParseFolderIds, mockUpdateFileFolderIds, mockGetAllFiles);

      expect(mockDb.update).toHaveBeenCalled();
      expect(capturedUpdate).toEqual({ parentId: newParentId });

      getFolderByIdSpy.mockRestore();
      isDescendantOfSpy.mockRestore();
      getFolderByNameAndParentSpy.mockRestore();
    });

    it('should merge folders when moving to parent with same-named child', async () => {
      const sourceFolderId = 5;
      const targetFolderId = 10;
      const newParentId = 2;

      const sourceFolder = {
        id: sourceFolderId,
        name: 'SharedName',
        parentId: 1,
        isExpanded: false,
        createdAt: null,
      };

      const existingFolder = {
        id: targetFolderId,
        name: 'SharedName',
        parentId: newParentId,
        isExpanded: false,
        createdAt: null,
      };

      const getFolderByIdSpy = vi.spyOn(folderOps, 'getFolderById').mockResolvedValue(sourceFolder);
      const getFolderByNameAndParentSpy = vi.spyOn(folderOps as unknown as { getFolderByNameAndParent: (name: string, parentId: number) => Promise<unknown> }, 'getFolderByNameAndParent').mockResolvedValue(existingFolder);
      const isDescendantOfSpy = vi.spyOn(folderOps as unknown as { isDescendantOf: (folderId: number, targetId: number) => Promise<boolean> }, 'isDescendantOf').mockResolvedValue(false);
      const getChildFoldersSpy = vi.spyOn(folderOps as unknown as { getChildFolders: (parentId: number) => Promise<unknown[]> }, 'getChildFolders').mockResolvedValue([]);

      mockDb.delete = vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined)
      });

      await folderOps.moveFolder(sourceFolderId, newParentId, mockParseFolderIds, mockUpdateFileFolderIds, mockGetAllFiles);

      expect(mockDb.delete).toHaveBeenCalled();

      getFolderByIdSpy.mockRestore();
      getFolderByNameAndParentSpy.mockRestore();
      isDescendantOfSpy.mockRestore();
      getChildFoldersSpy.mockRestore();
    });
  });

  describe('removeFolder', () => {
    it('should throw error when removing non-existent folder and validate before database operations', async () => {
      const getFolderByIdSpy = vi.spyOn(folderOps, 'getFolderById').mockResolvedValue(undefined);

      await expect(
        folderOps.removeFolder(999, mockParseFolderIds, mockUpdateFileFolderIds, mockGetAllFiles)
      ).rejects.toThrow('Folder not found');

      // Verify no database operations occurred
      expect(mockDb.select).not.toHaveBeenCalled();
      expect(mockDb.update).not.toHaveBeenCalled();
      expect(mockDb.delete).not.toHaveBeenCalled();

      getFolderByIdSpy.mockRestore();
    });

    it('should remove folder and move children to parent', async () => {
      const folderId = 5;
      const parentId = 1;
      const childId1 = 10;
      const childId2 = 11;

      const folder = {
        id: folderId,
        name: 'FolderToRemove',
        parentId: parentId,
        isExpanded: false,
        createdAt: null,
      };

      const children = [
        { id: childId1, name: 'Child1', parentId: folderId, isExpanded: false, createdAt: null },
        { id: childId2, name: 'Child2', parentId: folderId, isExpanded: false, createdAt: null },
      ];

      const getFolderByIdSpy = vi.spyOn(folderOps, 'getFolderById').mockResolvedValue(folder);
      const getChildFoldersSpy = vi.spyOn(folderOps as unknown as { getChildFolders: (parentId: number) => Promise<unknown[]> }, 'getChildFolders').mockResolvedValue(children);
      const getFolderByNameAndParentSpy = vi.spyOn(folderOps as unknown as { getFolderByNameAndParent: (name: string, parentId: number) => Promise<unknown> }, 'getFolderByNameAndParent').mockResolvedValue(undefined);
      const getAllDescendantIdsSpy = vi.spyOn(folderOps, 'getAllDescendantIds').mockResolvedValue([]);

      mockDb.update = vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined)
        })
      });

      mockDb.delete = vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined)
      });

      await folderOps.removeFolder(folderId, mockParseFolderIds, mockUpdateFileFolderIds, mockGetAllFiles);

      expect(mockDb.update).toHaveBeenCalled();
      expect(mockDb.delete).toHaveBeenCalled();

      getFolderByIdSpy.mockRestore();
      getChildFoldersSpy.mockRestore();
      getFolderByNameAndParentSpy.mockRestore();
      getAllDescendantIdsSpy.mockRestore();
    });

    it('should preserve files that exist in other folders when removing folder', async () => {
      const folderId = 5;
      const parentId = 0;

      const folder = {
        id: folderId,
        name: 'FolderToRemove',
        parentId: parentId,
        isExpanded: false,
        createdAt: null,
      };

      const sharedFile = {
        id: 101,
        filename: 'shared.txt',
        path: '/shared.txt',
        folderIds: JSON.stringify([folderId, 10, 20]),
        filetype: 'text',
        fileStorageType: 'import',
        addedAt: null,
      };

      const getFolderByIdSpy = vi.spyOn(folderOps, 'getFolderById').mockResolvedValue(folder);
      const getChildFoldersSpy = vi.spyOn(folderOps as unknown as { getChildFolders: (parentId: number) => Promise<unknown[]> }, 'getChildFolders').mockResolvedValue([]);
      const getAllDescendantIdsSpy = vi.spyOn(folderOps, 'getAllDescendantIds').mockResolvedValue([]);

      mockGetAllFiles.mockResolvedValue([sharedFile]);

      mockDb.delete = vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined)
      });

      await folderOps.removeFolder(folderId, mockParseFolderIds, mockUpdateFileFolderIds, mockGetAllFiles);

      expect(mockUpdateFileFolderIds).toHaveBeenCalledWith(101, [10, 20]);
      expect(mockDb.delete).toHaveBeenCalled();

      getFolderByIdSpy.mockRestore();
      getChildFoldersSpy.mockRestore();
      getAllDescendantIdsSpy.mockRestore();
    });

    it('should merge child folders with same-named siblings when parent is removed', async () => {
      const parentFolderId = 5;
      const grandparentId = 1;
      const childFolderId = 10;
      const existingSiblingId = 20;

      const parentFolder = {
        id: parentFolderId,
        name: 'Parent',
        parentId: grandparentId,
        isExpanded: false,
        createdAt: null,
      };

      const childFolder = {
        id: childFolderId,
        name: 'SharedName',
        parentId: parentFolderId,
        isExpanded: false,
        createdAt: null,
      };

      const existingSibling = {
        id: existingSiblingId,
        name: 'SharedName',
        parentId: grandparentId,
        isExpanded: false,
        createdAt: null,
      };

      const getFolderByIdSpy = vi.spyOn(folderOps, 'getFolderById').mockResolvedValue(parentFolder);
      const getChildFoldersSpy = vi.spyOn(folderOps as unknown as { getChildFolders: (parentId: number) => Promise<unknown[]> }, 'getChildFolders').mockResolvedValue([childFolder]);
      const getFolderByNameAndParentSpy = vi.spyOn(folderOps as unknown as { getFolderByNameAndParent: (name: string, parentId: number) => Promise<unknown> }, 'getFolderByNameAndParent').mockResolvedValue(existingSibling);
      const getAllDescendantIdsSpy = vi.spyOn(folderOps, 'getAllDescendantIds').mockResolvedValue([]);
      const mergeFoldersSpy = vi.spyOn(folderOps as unknown as { mergeFolders: (sourceId: number, targetId: number, parseFolderIds: (json: string | null) => number[], updateFileFolderIds: (fileId: number, folderIds: number[]) => Promise<void>, getAllFiles: () => Promise<unknown[]>) => Promise<void> }, 'mergeFolders').mockResolvedValue(undefined);

      mockDb.delete = vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined)
      });

      await folderOps.removeFolder(parentFolderId, mockParseFolderIds, mockUpdateFileFolderIds, mockGetAllFiles);

      expect(mergeFoldersSpy).toHaveBeenCalled();
      expect(mockDb.delete).toHaveBeenCalled();

      getFolderByIdSpy.mockRestore();
      getChildFoldersSpy.mockRestore();
      getFolderByNameAndParentSpy.mockRestore();
      getAllDescendantIdsSpy.mockRestore();
      mergeFoldersSpy.mockRestore();
    });
  });

  describe('deleteFolder', () => {
    it('should throw error when deleting non-existent folder and validate before database operations', async () => {
      const getFolderByIdSpy = vi.spyOn(folderOps, 'getFolderById').mockResolvedValue(undefined);

      await expect(
        folderOps.deleteFolder(999, mockParseFolderIds, mockDeleteFile, mockUpdateFileFolderIds, mockGetAllFiles)
      ).rejects.toThrow('Folder not found');

      // Verify no database operations occurred
      expect(mockDb.select).not.toHaveBeenCalled();
      expect(mockDb.update).not.toHaveBeenCalled();
      expect(mockDb.delete).not.toHaveBeenCalled();
      expect(mockDeleteFile).not.toHaveBeenCalled();

      getFolderByIdSpy.mockRestore();
    });

    it('should cascade delete unique files and locally remove non-unique files', async () => {
      const folderId = 5;
      const childId = 10;

      const folder = {
        id: folderId,
        name: 'FolderToDelete',
        parentId: 1,
        isExpanded: false,
        createdAt: null,
      };

      const uniqueFile = {
        id: 101,
        filename: 'unique.txt',
        path: '/unique.txt',
        folderIds: JSON.stringify([folderId, childId]),
        filetype: 'text',
        fileStorageType: 'import',
        addedAt: null,
      };

      const sharedFile = {
        id: 102,
        filename: 'shared.txt',
        path: '/shared.txt',
        folderIds: JSON.stringify([folderId, 20, 30]),
        filetype: 'text',
        fileStorageType: 'import',
        addedAt: null,
      };

      const otherFile = {
        id: 103,
        filename: 'other.txt',
        path: '/other.txt',
        folderIds: JSON.stringify([20, 30]),
        filetype: 'text',
        fileStorageType: 'import',
        addedAt: null,
      };

      const getFolderByIdSpy = vi.spyOn(folderOps, 'getFolderById').mockResolvedValue(folder);
      const getAllDescendantIdsSpy = vi.spyOn(folderOps, 'getAllDescendantIds').mockResolvedValue([childId]);

      mockGetAllFiles.mockResolvedValue([uniqueFile, sharedFile, otherFile]);

      mockDb.delete = vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined)
      });

      await folderOps.deleteFolder(folderId, mockParseFolderIds, mockDeleteFile, mockUpdateFileFolderIds, mockGetAllFiles);

      expect(mockDeleteFile).toHaveBeenCalledWith(101);
      expect(mockDeleteFile).toHaveBeenCalledTimes(1);
      expect(mockUpdateFileFolderIds).toHaveBeenCalledWith(102, [20, 30]);
      expect(mockDeleteFile).not.toHaveBeenCalledWith(103);
      expect(mockUpdateFileFolderIds).not.toHaveBeenCalledWith(103, expect.anything());
      expect(mockDb.delete).toHaveBeenCalled();

      getFolderByIdSpy.mockRestore();
      getAllDescendantIdsSpy.mockRestore();
    });

    it('should handle files in root and other folders when deleting all root children', async () => {
      // Simulates the "clear all" scenario: file exists in root (0) and a folder that will be deleted
      const folderId = 5;

      const folder = {
        id: folderId,
        name: 'RootChildFolder',
        parentId: 0,
        isExpanded: false,
        createdAt: null,
      };

      // File exists in both root (0) and folder 5
      const multiplyImportedFile = {
        id: 101,
        filename: 'multi.txt',
        path: '/multi.txt',
        folderIds: JSON.stringify([0, folderId]),
        filetype: 'text',
        fileStorageType: 'import',
        addedAt: null,
      };

      // File only exists in folder 5
      const uniqueFile = {
        id: 102,
        filename: 'unique.txt',
        path: '/unique.txt',
        folderIds: JSON.stringify([folderId]),
        filetype: 'text',
        fileStorageType: 'import',
        addedAt: null,
      };

      // File only exists in root
      const rootOnlyFile = {
        id: 103,
        filename: 'root.txt',
        path: '/root.txt',
        folderIds: JSON.stringify([0]),
        filetype: 'text',
        fileStorageType: 'import',
        addedAt: null,
      };

      const getFolderByIdSpy = vi.spyOn(folderOps, 'getFolderById').mockResolvedValue(folder);
      const getAllDescendantIdsSpy = vi.spyOn(folderOps, 'getAllDescendantIds').mockResolvedValue([]);

      mockGetAllFiles.mockResolvedValue([multiplyImportedFile, uniqueFile, rootOnlyFile]);

      mockDb.delete = vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined)
      });

      await folderOps.deleteFolder(folderId, mockParseFolderIds, mockDeleteFile, mockUpdateFileFolderIds, mockGetAllFiles);

      // Multiply-imported file should be updated to only have root (0)
      expect(mockUpdateFileFolderIds).toHaveBeenCalledWith(101, [0]);

      // Unique file should be completely deleted
      expect(mockDeleteFile).toHaveBeenCalledWith(102);

      // Root-only file should not be touched at all
      expect(mockDeleteFile).not.toHaveBeenCalledWith(103);
      expect(mockUpdateFileFolderIds).not.toHaveBeenCalledWith(103, expect.anything());

      // Folder should be deleted
      expect(mockDb.delete).toHaveBeenCalled();

      getFolderByIdSpy.mockRestore();
      getAllDescendantIdsSpy.mockRestore();
    });
  });

  describe('toggleFolderExpanded', () => {
    it('should toggle folder expansion state', async () => {
      const folderId = 5;

      const getFolderByIdSpy = vi.spyOn(folderOps, 'getFolderById').mockResolvedValue({
        id: folderId,
        name: 'Folder',
        parentId: 0,
        isExpanded: false,
        createdAt: null,
      });

      mockDb.update = vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined)
        })
      });

      await folderOps.toggleFolderExpanded(folderId);

      expect(mockDb.update).toHaveBeenCalled();
      getFolderByIdSpy.mockRestore();
    });

    it('should throw error when toggling non-existent folder and validate before database operations', async () => {
      const folderId = 999;

      const getFolderByIdSpy = vi.spyOn(folderOps, 'getFolderById').mockResolvedValue(undefined);

      await expect(
        folderOps.toggleFolderExpanded(folderId)
      ).rejects.toThrow('Folder not found');

      // Verify no database operations occurred
      expect(mockDb.update).not.toHaveBeenCalled();

      getFolderByIdSpy.mockRestore();
    });
  });

  describe('expandAncestorFolders', () => {
    it('should expand all ancestor folders for a given folder', async () => {
      const folderId = 10;
      const parentFolder = { id: 5, name: 'Parent', parentId: 0, isExpanded: false, createdAt: null };

      const getFolderByIdSpy = vi.spyOn(folderOps, 'getFolderById')
        .mockResolvedValueOnce({ id: folderId, name: 'Child', parentId: 5, isExpanded: false, createdAt: null })
        .mockResolvedValueOnce(parentFolder);

      mockDb.update = vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined)
        })
      });

      await folderOps.expandAncestorFolders(folderId);

      expect(getFolderByIdSpy).toHaveBeenCalled();
      getFolderByIdSpy.mockRestore();
    });

    it('should handle folder with no parent (root level)', async () => {
      const folderId = 1;

      const getFolderByIdSpy = vi.spyOn(folderOps, 'getFolderById')
        .mockResolvedValueOnce({ id: folderId, name: 'Root', parentId: 0, isExpanded: false, createdAt: null });

      await folderOps.expandAncestorFolders(folderId);

      expect(getFolderByIdSpy).toHaveBeenCalledWith(folderId);
      getFolderByIdSpy.mockRestore();
    });

    it('should handle already-expanded folder (idempotence)', async () => {
      const folderId = 10;
      const parentId = 5;

      const getFolderByIdSpy = vi.spyOn(folderOps, 'getFolderById')
        .mockResolvedValueOnce({ id: folderId, name: 'Child', parentId: parentId, isExpanded: true, createdAt: null })
        .mockResolvedValueOnce({ id: parentId, name: 'Parent', parentId: 0, isExpanded: true, createdAt: null });

      mockDb.update = vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined)
        })
      });

      await folderOps.expandAncestorFolders(folderId);

      expect(getFolderByIdSpy).toHaveBeenCalled();
      getFolderByIdSpy.mockRestore();
    });
  });

  describe('getAllAncestorIds', () => {
    it('should return all ancestor IDs for a deeply nested folder', async () => {
      const grandchildId = 3;
      const childId = 2;
      const parentId = 1;

      const getFolderByIdSpy = vi.spyOn(folderOps, 'getFolderById')
        .mockResolvedValueOnce({ id: grandchildId, name: 'Grandchild', parentId: childId, isExpanded: false, createdAt: null })
        .mockResolvedValueOnce({ id: childId, name: 'Child', parentId: parentId, isExpanded: false, createdAt: null })
        .mockResolvedValueOnce({ id: parentId, name: 'Parent', parentId: 0, isExpanded: false, createdAt: null });

      const result = await folderOps.getAllAncestorIds(grandchildId);

      expect(result).toEqual([grandchildId, childId, parentId]);
      getFolderByIdSpy.mockRestore();
    });

    it('should return empty array when folder has no ancestors', async () => {
      // Test with root folder (id=0)
      const rootResult = await folderOps.getAllAncestorIds(0);
      expect(rootResult).toEqual([]);
    });

    it('should throw error for non-existent folder', async () => {
      const getFolderByIdSpy = vi.spyOn(folderOps, 'getFolderById')
        .mockResolvedValueOnce(undefined);

      await expect(
        folderOps.getAllAncestorIds(999)
      ).rejects.toThrow('Folder not found');

      getFolderByIdSpy.mockRestore();
    });

    it('should stop traversal if ancestor chain is broken', async () => {
      const childId = 2;
      const parentId = 1;

      const getFolderByIdSpy = vi.spyOn(folderOps, 'getFolderById')
        .mockResolvedValueOnce({ id: childId, name: 'Child', parentId: parentId, isExpanded: false, createdAt: null })
        .mockResolvedValueOnce(undefined);

      const result = await folderOps.getAllAncestorIds(childId);

      expect(result).toEqual([childId]);
      getFolderByIdSpy.mockRestore();
    });
  });

  describe('getAllDescendantIds', () => {
    it('should return all descendant IDs for a folder with nested descendants', async () => {
      const folderId = 1;
      const childId = 2;
      const grandchildId = 3;

      const getFolderByIdSpy = vi.spyOn(folderOps, 'getFolderById')
        .mockResolvedValueOnce({ id: folderId, name: 'Folder', parentId: 0, isExpanded: false, createdAt: null })
        .mockResolvedValueOnce({ id: childId, name: 'Child', parentId: folderId, isExpanded: false, createdAt: null })
        .mockResolvedValueOnce({ id: childId, name: 'Child', parentId: folderId, isExpanded: false, createdAt: null })
        .mockResolvedValueOnce({ id: grandchildId, name: 'Grandchild', parentId: childId, isExpanded: false, createdAt: null })
        .mockResolvedValueOnce({ id: grandchildId, name: 'Grandchild', parentId: childId, isExpanded: false, createdAt: null });

      mockDb.select = vi.fn()
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([{ id: childId, name: 'Child', parentId: folderId, isExpanded: false, createdAt: null }])
          })
        })
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([{ id: grandchildId, name: 'Grandchild', parentId: childId, isExpanded: false, createdAt: null }])
          })
        })
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([])
          })
        });

      const result = await folderOps.getAllDescendantIds(folderId);

      expect(result).toEqual([childId, grandchildId]);
      getFolderByIdSpy.mockRestore();
    });

    it('should return empty array when folder has no descendants', async () => {
      // Test with regular folder
      const folderId = 1;
      const getFolderByIdSpy = vi.spyOn(folderOps, 'getFolderById')
        .mockResolvedValueOnce({ id: folderId, name: 'Folder', parentId: 0, isExpanded: false, createdAt: null });

      mockDb.select = vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([])
        })
      });

      const result = await folderOps.getAllDescendantIds(folderId);
      expect(result).toEqual([]);

      // Test with root folder (id=0)
      const rootResult = await folderOps.getAllDescendantIds(0);
      expect(rootResult).toEqual([]);

      getFolderByIdSpy.mockRestore();
    });

    it('should throw error for non-existent folder', async () => {
      const nonExistentFolderId = 999;

      const getFolderByIdSpy = vi.spyOn(folderOps, 'getFolderById').mockResolvedValue(undefined);

      await expect(
        folderOps.getAllDescendantIds(nonExistentFolderId)
      ).rejects.toThrow('Folder not found');

      getFolderByIdSpy.mockRestore();
    });

    it('should stop traversal if descendant chain is broken', async () => {
      const folderId = 1;
      const childId = 2;

      const getFolderByIdSpy = vi.spyOn(folderOps, 'getFolderById')
        .mockResolvedValueOnce({ id: folderId, name: 'Folder', parentId: 0, isExpanded: false, createdAt: null })
        .mockResolvedValueOnce(undefined);

      mockDb.select = vi.fn()
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([{ id: childId, name: 'Child', parentId: folderId, isExpanded: false, createdAt: null }])
          })
        });

      const result = await folderOps.getAllDescendantIds(folderId);

      expect(result).toEqual([]);
      getFolderByIdSpy.mockRestore();
    });
  });
});
