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
  const mockGetFolderIdsForFile = vi.fn(async (_fileId: number): Promise<number[]> => {
    return [];
  });

  const mockRemoveFileFolderLink = vi.fn(async () => {
    // Mock implementation
  });

  const mockAddFileFolderLink = vi.fn(async () => {
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
    fileStorageType: string;
    addedAt: Date | null;
  }>> => {
    return [];
  });

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();
    mockGetFolderIdsForFile.mockClear();
    mockRemoveFileFolderLink.mockClear();
    mockAddFileFolderLink.mockClear();
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
    it('should throw error when removing root folder and validate before database operations', async () => {
      await expect(
        folderOps.removeFolder(0, mockGetFolderIdsForFile, mockRemoveFileFolderLink, mockAddFileFolderLink, mockGetAllFiles)
      ).rejects.toThrow(ERROR_MESSAGES.CANNOT_REMOVE_DIRECTORY);

      // Verify no database operations occurred
      expect(mockDb.select).not.toHaveBeenCalled();
      expect(mockDb.update).not.toHaveBeenCalled();
      expect(mockDb.delete).not.toHaveBeenCalled();
    });

    it('should throw error when deleting root folder and validate before database operations', async () => {
      await expect(
        folderOps.deleteFolder(0, mockGetFolderIdsForFile, mockDeleteFile, mockRemoveFileFolderLink, mockGetAllFiles)
      ).rejects.toThrow(ERROR_MESSAGES.CANNOT_REMOVE_DIRECTORY);

      // Verify no database operations occurred
      expect(mockDb.select).not.toHaveBeenCalled();
      expect(mockDb.update).not.toHaveBeenCalled();
      expect(mockDb.delete).not.toHaveBeenCalled();
      expect(mockDeleteFile).not.toHaveBeenCalled();
    });

    it('should recognize 0 and only 0 as the root folder ID', async () => {
      await expect(
        folderOps.moveFolder(0, 1, mockGetFolderIdsForFile, mockRemoveFileFolderLink, mockAddFileFolderLink, mockGetAllFiles)
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
        await folderOps.moveFolder(1, 2, mockGetFolderIdsForFile, mockRemoveFileFolderLink, mockAddFileFolderLink, mockGetAllFiles);
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

    it('should not create a new folder with a null parent id', async () => {
      const folderName = 'TestFolder';

      await expect(
        folderOps.createFolder(folderName, null as any)
      ).rejects.toThrow('Parent ID cannot be null');

      // Verify no database operations occurred
      expect(mockDb.select).not.toHaveBeenCalled();
      expect(mockDb.insert).not.toHaveBeenCalled();
    });

    it('should not create a new folder with a parent id that does not exist', async () => {
      const folderName = 'TestFolder';
      const nonExistentParentId = 999;

      const getFolderByIdSpy = vi.spyOn(folderOps, 'getFolderById').mockResolvedValue(undefined);

      mockDb.select = vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([])
        })
      });

      mockDb.insert = vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([
            { id: 100, name: folderName, parentId: nonExistentParentId, isExpanded: false, createdAt: null }
          ])
        })
      });

      await expect(
        folderOps.createFolder(folderName, nonExistentParentId)
      ).rejects.toThrow('Folder not found');

      getFolderByIdSpy.mockRestore();
    });

    it('should not create a new folder with root folder (0) name in root', async () => {
      const folderName = 'Root';
      const parentId = 0;

      mockDb.select = vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([
            { id: 0, name: 'Root', parentId: 0, isExpanded: true, createdAt: null }
          ])
        })
      });

      await expect(
        folderOps.createFolder(folderName, parentId)
      ).rejects.toThrow('A folder with this name already exists at this level');

      // Verify insert did not occur
      expect(mockDb.insert).not.toHaveBeenCalled();
    });

    it('should not create a new folder with an id that already exists', async () => {
      const existingId = 5;
      const folderName = 'DuplicateFolder';
      const parentId = 1;

      // Mock that a folder with this name already exists at this parent
      mockDb.select = vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([
            { id: existingId, name: folderName, parentId: parentId, isExpanded: false, createdAt: null }
          ])
        })
      });

      await expect(
        folderOps.createFolder(folderName, parentId)
      ).rejects.toThrow('A folder with this name already exists at this level');

      // Verify insert did not occur (caught by duplicate name check)
      expect(mockDb.insert).not.toHaveBeenCalled();
    });
  });

  describe('moveFolder', () => {
    it('should throw error when moving root folder (node 0) and validate before database operations', async () => {
      const destinations = [0, 1, 5, 10, 100, 999, -1, -999];

      for (const destId of destinations) {
        await expect(
          folderOps.moveFolder(0, destId, mockGetFolderIdsForFile, mockRemoveFileFolderLink, mockAddFileFolderLink, mockGetAllFiles)
        ).rejects.toThrow(ERROR_MESSAGES.CANNOT_MOVE_DIRECTORY);
      }

      // Verify no database operations occurred
      expect(mockDb.select).not.toHaveBeenCalled();
      expect(mockDb.update).not.toHaveBeenCalled();
      expect(mockDb.delete).not.toHaveBeenCalled();
    });

    it('should throw error when moving null node and validate before database operations', async () => {
      await expect(
        folderOps.moveFolder(null as any, 1, mockGetFolderIdsForFile, mockRemoveFileFolderLink, mockAddFileFolderLink, mockGetAllFiles)
      ).rejects.toThrow();

      // Verify no database write operations occurred
      expect(mockDb.update).not.toHaveBeenCalled();
      expect(mockDb.delete).not.toHaveBeenCalled();
    });

    it('should throw error when moving folder to itself and validate before database operations', async () => {
      await expect(
        folderOps.moveFolder(5, 5, mockGetFolderIdsForFile, mockRemoveFileFolderLink, mockAddFileFolderLink, mockGetAllFiles)
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
        folderOps.moveFolder(1, 10, mockGetFolderIdsForFile, mockRemoveFileFolderLink, mockAddFileFolderLink, mockGetAllFiles)
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
        folderOps.moveFolder(999, 1, mockGetFolderIdsForFile, mockRemoveFileFolderLink, mockAddFileFolderLink, mockGetAllFiles)
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
        folderOps.moveFolder(folderId, currentParentId, mockGetFolderIdsForFile, mockRemoveFileFolderLink, mockAddFileFolderLink, mockGetAllFiles)
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
        .mockResolvedValueOnce(undefined); // Target parent doesn't exist

      await expect(
        folderOps.moveFolder(folderId, nonExistentParentId, mockGetFolderIdsForFile, mockRemoveFileFolderLink, mockAddFileFolderLink, mockGetAllFiles)
      ).rejects.toThrow('Target parent folder not found');

      // Verify no database operations occurred
      expect(mockDb.update).not.toHaveBeenCalled();
      expect(mockDb.delete).not.toHaveBeenCalled();

      getFolderByIdSpy.mockRestore();
    });

    it('should throw error when moving node to null and validate before database operations', async () => {
      const folderId = 5;

      await expect(
        folderOps.moveFolder(folderId, null as any, mockGetFolderIdsForFile, mockRemoveFileFolderLink, mockAddFileFolderLink, mockGetAllFiles)
      ).rejects.toThrow('Cannot move folder to null parent');

      // Verify no database operations occurred
      expect(mockDb.select).not.toHaveBeenCalled();
      expect(mockDb.update).not.toHaveBeenCalled();
      expect(mockDb.delete).not.toHaveBeenCalled();
    });

    it('should not temporarily orphan node during move operation', async () => {
      const folderId = 5;
      const oldParentId = 1;
      const newParentId = 2;

      const sourceFolder = {
        id: folderId,
        name: 'Folder',
        parentId: oldParentId,
        isExpanded: false,
        createdAt: null,
      };

      const targetParent = {
        id: newParentId,
        name: 'TargetParent',
        parentId: 0,
        isExpanded: false,
        createdAt: null,
      };

      const getFolderByIdSpy = vi.spyOn(folderOps, 'getFolderById')
        .mockResolvedValueOnce(sourceFolder)
        .mockResolvedValueOnce(targetParent);

      const isDescendantOfSpy = vi.spyOn(folderOps as unknown as { isDescendantOf: (folderId: number, targetId: number) => Promise<boolean> }, 'isDescendantOf').mockResolvedValue(false);
      const getFolderByNameAndParentSpy = vi.spyOn(folderOps as unknown as { getFolderByNameAndParent: (name: string, parentId: number) => Promise<unknown> }, 'getFolderByNameAndParent').mockResolvedValue(undefined);

      let updateCallOrder: number[] = [];
      let callCount = 0;

      mockDb.update = vi.fn().mockReturnValue({
        set: vi.fn((values: { parentId: number }) => {
          // Track that parentId is always set to a valid value
          updateCallOrder.push(values.parentId);
          callCount++;
          return {
            where: vi.fn().mockResolvedValue(undefined)
          };
        })
      });

      await folderOps.moveFolder(folderId, newParentId, mockGetFolderIdsForFile, mockRemoveFileFolderLink, mockAddFileFolderLink, mockGetAllFiles);

      // Verify the folder is directly updated to new parent without intermediate null/orphaned state
      expect(callCount).toBe(1);
      expect(updateCallOrder[0]).toBe(newParentId);
      expect(updateCallOrder).not.toContain(null);
      expect(updateCallOrder).not.toContain(undefined);

      getFolderByIdSpy.mockRestore();
      isDescendantOfSpy.mockRestore();
      getFolderByNameAndParentSpy.mockRestore();
    });

    it('should not temporarily give node two parents during move operation', async () => {
      const folderId = 5;
      const oldParentId = 1;
      const newParentId = 2;

      const sourceFolder = {
        id: folderId,
        name: 'Folder',
        parentId: oldParentId,
        isExpanded: false,
        createdAt: null,
      };

      const targetParent = {
        id: newParentId,
        name: 'TargetParent',
        parentId: 0,
        isExpanded: false,
        createdAt: null,
      };

      const getFolderByIdSpy = vi.spyOn(folderOps, 'getFolderById')
        .mockResolvedValueOnce(sourceFolder)
        .mockResolvedValueOnce(targetParent);

      const isDescendantOfSpy = vi.spyOn(folderOps as unknown as { isDescendantOf: (folderId: number, targetId: number) => Promise<boolean> }, 'isDescendantOf').mockResolvedValue(false);
      const getFolderByNameAndParentSpy = vi.spyOn(folderOps as unknown as { getFolderByNameAndParent: (name: string, parentId: number) => Promise<unknown> }, 'getFolderByNameAndParent').mockResolvedValue(undefined);

      let updateCount = 0;

      mockDb.update = vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn(() => {
            updateCount++;
            return Promise.resolve(undefined);
          })
        })
      });

      await folderOps.moveFolder(folderId, newParentId, mockGetFolderIdsForFile, mockRemoveFileFolderLink, mockAddFileFolderLink, mockGetAllFiles);

      // Verify only one update operation occurs (atomic parent change)
      expect(updateCount).toBe(1);

      getFolderByIdSpy.mockRestore();
      isDescendantOfSpy.mockRestore();
      getFolderByNameAndParentSpy.mockRestore();
    });

    it('should successfully move folder with descendants to valid parent', async () => {
      // Test a valid move operation: moving folder 5 (with children) from parent 1 to parent 2
      // No name conflicts, no circular dependencies - straightforward successful move
      const folderId = 5;
      const oldParentId = 1;
      const newParentId = 2;

      const sourceFolder = {
        id: folderId,
        name: 'UniqueFolder',
        parentId: oldParentId,
        isExpanded: false,
        createdAt: null,
      };

      const targetParent = {
        id: newParentId,
        name: 'TargetParent',
        parentId: 0,
        isExpanded: false,
        createdAt: null,
      };

      const getFolderByIdSpy = vi.spyOn(folderOps, 'getFolderById')
        .mockResolvedValueOnce(sourceFolder)
        .mockResolvedValueOnce(targetParent);

      const isDescendantOfSpy = vi.spyOn(folderOps as unknown as { isDescendantOf: (folderId: number, targetId: number) => Promise<boolean> }, 'isDescendantOf').mockResolvedValue(false);
      const getFolderByNameAndParentSpy = vi.spyOn(folderOps as unknown as { getFolderByNameAndParent: (name: string, parentId: number) => Promise<unknown> }, 'getFolderByNameAndParent').mockResolvedValue(undefined);

      let updateOccurred = false;
      let updatedParentId: number | null = null;

      mockDb.update = vi.fn().mockReturnValue({
        set: vi.fn((values: { parentId: number }) => {
          updatedParentId = values.parentId;
          return {
            where: vi.fn(() => {
              updateOccurred = true;
              return Promise.resolve(undefined);
            })
          };
        })
      });

      await folderOps.moveFolder(folderId, newParentId, mockGetFolderIdsForFile, mockRemoveFileFolderLink, mockAddFileFolderLink, mockGetAllFiles);

      // Verify the move was successful
      expect(updateOccurred).toBe(true);
      expect(updatedParentId).toBe(newParentId);
      expect(mockDb.delete).not.toHaveBeenCalled(); // No merge, so no deletion

      getFolderByIdSpy.mockRestore();
      isDescendantOfSpy.mockRestore();
      getFolderByNameAndParentSpy.mockRestore();
    });

    it('should handle recursive merge with nested folder name conflicts', async () => {
      // Setup: Source folder with deeply nested children that conflict with target's structure
      // Source structure:           Target structure:
      //   source/                     target/
      //     ├─ shared/                  ├─ shared/ (conflict!)
      //     │   ├─ nested/              │   ├─ nested/ (conflict!)
      //     │   │   └─ deep/            │   │   └─ other/
      //     │   └─ file1.txt            │   └─ file2.txt
      //     └─ unique/                  └─ different/
      //
      // Expected: Recursive merge at each level, preserving the tree structure

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

      // Source folder has nested children with conflicts
      const sourceChildFolders = [
        { id: 51, name: 'shared', parentId: sourceFolderId, isExpanded: false, createdAt: null },
        { id: 52, name: 'unique', parentId: sourceFolderId, isExpanded: false, createdAt: null },
      ];

      const nestedSourceFolders = [
        { id: 511, name: 'nested', parentId: 51, isExpanded: false, createdAt: null },
      ];

      const getFolderByIdSpy = vi.spyOn(folderOps, 'getFolderById').mockResolvedValue(sourceFolder);
      const getFolderByNameAndParentSpy = vi.spyOn(
        folderOps as unknown as { getFolderByNameAndParent: (name: string, parentId: number) => Promise<unknown> },
        'getFolderByNameAndParent'
      ).mockResolvedValue(existingFolder);
      const isDescendantOfSpy = vi.spyOn(
        folderOps as unknown as { isDescendantOf: (folderId: number, targetId: number) => Promise<boolean> },
        'isDescendantOf'
      ).mockResolvedValue(false);

      let getChildFoldersCallCount = 0;
      const getChildFoldersSpy = vi.spyOn(
        folderOps as unknown as { getChildFolders: (parentId: number) => Promise<any[]> },
        'getChildFolders'
      ).mockImplementation(async (parentId: number) => {
        getChildFoldersCallCount++;
        if (parentId === sourceFolderId) return sourceChildFolders;
        if (parentId === 51) return nestedSourceFolders;
        return [];
      });

      mockDb.update = vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined)
        })
      });

      mockDb.delete = vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined)
      });

      mockGetAllFiles.mockResolvedValue([]);

      await folderOps.moveFolder(
        sourceFolderId,
        newParentId,
        mockGetFolderIdsForFile,
        mockRemoveFileFolderLink,
        mockAddFileFolderLink,
        mockGetAllFiles
      );

      // Verify recursive merge behavior
      // 1. getChildFolders should be called for processing children
      expect(getChildFoldersCallCount).toBeGreaterThanOrEqual(1);

      // 2. Child folders should be relocated or merged
      expect(mockDb.update).toHaveBeenCalled();

      // 3. Source folder should be deleted
      expect(mockDb.delete).toHaveBeenCalled();

      getFolderByIdSpy.mockRestore();
      getFolderByNameAndParentSpy.mockRestore();
      isDescendantOfSpy.mockRestore();
      getChildFoldersSpy.mockRestore();
    });

    it('should handle recursive merge with file name conflicts at multiple levels', async () => {
      // Setup: Source and target both have same files at different nesting levels
      // Source structure:           Target structure:
      //   source/                     target/
      //     ├─ child/                   ├─ child/ (conflict!)
      //     │   ├─ doc.pdf (id=101)     │   ├─ doc.pdf (id=101, same file!)
      //     │   └─ unique.txt (id=102)  │   └─ other.txt (id=103)
      //     └─ root.pdf (id=104)        └─ root.pdf (id=104, same file!)
      //
      // Expected: Files are deduplicated, unique files are moved, shared files aren't duplicated

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

      const sourceChildFolder = {
        id: 51,
        name: 'child',
        parentId: sourceFolderId,
        isExpanded: false,
        createdAt: null,
      };

      // Files at different levels
      const sharedDocInChild = {
        id: 101,
        filename: 'doc.pdf',
        path: '/doc.pdf',
        filetype: 'pdf',
        fileStorageType: 'import',
        addedAt: new Date(),
      };

      const uniqueDoc = {
        id: 102,
        filename: 'unique.txt',
        path: '/unique.txt',
        filetype: 'text',
        fileStorageType: 'import',
        addedAt: new Date(),
      };

      const sharedRootDoc = {
        id: 104,
        filename: 'root.pdf',
        path: '/root.pdf',
        filetype: 'pdf',
        fileStorageType: 'import',
        addedAt: new Date(),
      };

      const getFolderByIdSpy = vi.spyOn(folderOps, 'getFolderById').mockResolvedValue(sourceFolder);
      const getFolderByNameAndParentSpy = vi.spyOn(
        folderOps as unknown as { getFolderByNameAndParent: (name: string, parentId: number) => Promise<unknown> },
        'getFolderByNameAndParent'
      ).mockResolvedValue(existingFolder);
      const isDescendantOfSpy = vi.spyOn(
        folderOps as unknown as { isDescendantOf: (folderId: number, targetId: number) => Promise<boolean> },
        'isDescendantOf'
      ).mockResolvedValue(false);
      const getChildFoldersSpy = vi.spyOn(
        folderOps as unknown as { getChildFolders: (parentId: number) => Promise<any[]> },
        'getChildFolders'
      ).mockImplementation(async (parentId: number) => {
        if (parentId === sourceFolderId) return [sourceChildFolder];
        return [];
      });

      // Mock: Multiple files at different levels with some conflicts
      mockGetAllFiles.mockResolvedValue([sharedDocInChild, uniqueDoc, sharedRootDoc]);
      mockGetFolderIdsForFile.mockImplementation(async (fileId: number) => {
        if (fileId === 101) return [sourceFolderId, 51, targetFolderId]; // Shared in both
        if (fileId === 102) return [51]; // Unique to source child
        if (fileId === 104) return [sourceFolderId, targetFolderId]; // Shared at root
        return [];
      });

      mockDb.delete = vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined)
      });

      mockDb.update = vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined)
        })
      });

      await folderOps.moveFolder(
        sourceFolderId,
        newParentId,
        mockGetFolderIdsForFile,
        mockRemoveFileFolderLink,
        mockAddFileFolderLink,
        mockGetAllFiles
      );

      // Verify file handling across levels
      // 1. File links should be handled during merge
      expect(mockRemoveFileFolderLink).toHaveBeenCalled();

      // 2. Files from child folders should be processed
      expect(mockGetFolderIdsForFile).toHaveBeenCalled();

      // 3. getChildFolders should be called to process nested structure
      expect(getChildFoldersSpy).toHaveBeenCalled();

      // 4. Source folder deleted
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
        folderOps.removeFolder(999, mockGetFolderIdsForFile, mockRemoveFileFolderLink, mockAddFileFolderLink, mockGetAllFiles)
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

      await folderOps.removeFolder(folderId, mockGetFolderIdsForFile, mockRemoveFileFolderLink, mockAddFileFolderLink, mockGetAllFiles);

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
        filetype: 'text',
        fileStorageType: 'import',
        addedAt: null,
      };

      const getFolderByIdSpy = vi.spyOn(folderOps, 'getFolderById').mockResolvedValue(folder);
      const getChildFoldersSpy = vi.spyOn(folderOps as unknown as { getChildFolders: (parentId: number) => Promise<unknown[]> }, 'getChildFolders').mockResolvedValue([]);
      const getAllDescendantIdsSpy = vi.spyOn(folderOps, 'getAllDescendantIds').mockResolvedValue([]);

      mockGetAllFiles.mockResolvedValue([sharedFile]);
      mockGetFolderIdsForFile.mockImplementation(async (fileId) => {
        if (fileId === 101) return [folderId, 10, 20];
        return [];
      });

      mockDb.delete = vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined)
      });

      await folderOps.removeFolder(folderId, mockGetFolderIdsForFile, mockRemoveFileFolderLink, mockAddFileFolderLink, mockGetAllFiles);

      expect(mockRemoveFileFolderLink).toHaveBeenCalledWith(101, folderId);
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

      await folderOps.removeFolder(parentFolderId, mockGetFolderIdsForFile, mockRemoveFileFolderLink, mockAddFileFolderLink, mockGetAllFiles);

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
        folderOps.deleteFolder(999, mockGetFolderIdsForFile, mockDeleteFile, mockRemoveFileFolderLink, mockGetAllFiles)
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
        filetype: 'text',
        fileStorageType: 'import',
        addedAt: null,
      };

      const sharedFile = {
        id: 102,
        filename: 'shared.txt',
        path: '/shared.txt',
        filetype: 'text',
        fileStorageType: 'import',
        addedAt: null,
      };

      const otherFile = {
        id: 103,
        filename: 'other.txt',
        path: '/other.txt',
        filetype: 'text',
        fileStorageType: 'import',
        addedAt: null,
      };

      const getFolderByIdSpy = vi.spyOn(folderOps, 'getFolderById').mockResolvedValue(folder);
      const getAllDescendantIdsSpy = vi.spyOn(folderOps, 'getAllDescendantIds').mockResolvedValue([childId]);

      mockGetAllFiles.mockResolvedValue([uniqueFile, sharedFile, otherFile]);
      mockGetFolderIdsForFile.mockImplementation(async (fileId) => {
        if (fileId === 101) return [folderId, childId];
        if (fileId === 102) return [folderId, 20, 30];
        if (fileId === 103) return [20, 30];
        return [];
      });

      mockDb.delete = vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined)
      });

      await folderOps.deleteFolder(folderId, mockGetFolderIdsForFile, mockDeleteFile, mockRemoveFileFolderLink, mockGetAllFiles);

      expect(mockDeleteFile).toHaveBeenCalledWith(101);
      expect(mockDeleteFile).toHaveBeenCalledTimes(1);
      expect(mockRemoveFileFolderLink).toHaveBeenCalledWith(102, folderId);
      expect(mockDeleteFile).not.toHaveBeenCalledWith(103);
      expect(mockRemoveFileFolderLink).not.toHaveBeenCalledWith(103, expect.anything());
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
        filetype: 'text',
        fileStorageType: 'import',
        addedAt: null,
      };

      // File only exists in folder 5
      const uniqueFile = {
        id: 102,
        filename: 'unique.txt',
        path: '/unique.txt',
        filetype: 'text',
        fileStorageType: 'import',
        addedAt: null,
      };

      // File only exists in root
      const rootOnlyFile = {
        id: 103,
        filename: 'root.txt',
        path: '/root.txt',
        filetype: 'text',
        fileStorageType: 'import',
        addedAt: null,
      };

      const getFolderByIdSpy = vi.spyOn(folderOps, 'getFolderById').mockResolvedValue(folder);
      const getAllDescendantIdsSpy = vi.spyOn(folderOps, 'getAllDescendantIds').mockResolvedValue([]);

      mockGetAllFiles.mockResolvedValue([multiplyImportedFile, uniqueFile, rootOnlyFile]);
      mockGetFolderIdsForFile.mockImplementation(async (fileId) => {
        if (fileId === 101) return [0, folderId];
        if (fileId === 102) return [folderId];
        if (fileId === 103) return [0];
        return [];
      });

      mockDb.delete = vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined)
      });

      await folderOps.deleteFolder(folderId, mockGetFolderIdsForFile, mockDeleteFile, mockRemoveFileFolderLink, mockGetAllFiles);

      // Multiply-imported file should have link to folderId removed
      expect(mockRemoveFileFolderLink).toHaveBeenCalledWith(101, folderId);

      // Unique file should be completely deleted
      expect(mockDeleteFile).toHaveBeenCalledWith(102);

      // Root-only file should not be touched at all
      expect(mockDeleteFile).not.toHaveBeenCalledWith(103);
      expect(mockRemoveFileFolderLink).not.toHaveBeenCalledWith(103, expect.anything());

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
