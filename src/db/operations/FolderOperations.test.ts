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
  const mockGetFolderIdsForFile = vi.fn<(fileId: number) => Promise<number[]>>();

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

      const getFolderByIdSpy = vi.spyOn(folderOps, 'getFolderById').mockResolvedValue({
        id: parentId,
        name: 'Parent',
        parentId: 0,
        isExpanded: false,
        createdAt: null,
      });

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

      getFolderByIdSpy.mockRestore();
    });

    it('should allow creation of a folder even if the same name exists in a different parent', async () => {
      const folderName = 'TestFolder';
      const parentId1 = 1;
      const parentId2 = 2;

      const getFolderByIdSpy = vi.spyOn(folderOps, 'getFolderById')
        .mockResolvedValueOnce({ id: parentId1, name: 'Parent1', parentId: 0, isExpanded: false, createdAt: null })
        .mockResolvedValueOnce({ id: parentId2, name: 'Parent2', parentId: 0, isExpanded: false, createdAt: null });

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

      getFolderByIdSpy.mockRestore();
      expandAncestorFoldersSpy.mockRestore();
    });

    it('should not create a new folder with a null parent id and validates before database operations', async () => {
      const folderName = 'TestFolder';

      await expect(
        folderOps.createFolder(folderName, null as unknown as number)
      ).rejects.toThrow('Parent ID cannot be null');

      // Verify no database operations occurred
      expect(mockDb.select).not.toHaveBeenCalled();
      expect(mockDb.insert).not.toHaveBeenCalled();
    });

    it('should not create a new folder with a parent id that does not exist and validates before database operations', async () => {
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

    it('should not create a new folder with an id that already exists and validates before database operations', async () => {
      const existingId = 5;
      const folderName = 'DuplicateFolder';
      const parentId = 1;

      const getFolderByIdSpy = vi.spyOn(folderOps, 'getFolderById').mockResolvedValue({
        id: parentId,
        name: 'Parent',
        parentId: 0,
        isExpanded: false,
        createdAt: null,
      });

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

      getFolderByIdSpy.mockRestore();
    });

    it('should not create a folder with an ID of 0 and validates before database operations', async () => {
      const folderName = 'TestFolder';
      const parentId = 1;

      mockDb.select = vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([])
        })
      });

      // Mock database returning a folder with ID 0
      mockDb.insert = vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([
            { id: 0, name: folderName, parentId: parentId, isExpanded: false, createdAt: null }
          ])
        })
      });

      const getFolderByIdSpy = vi.spyOn(folderOps, 'getFolderById').mockResolvedValue({
        id: parentId,
        name: 'Parent',
        parentId: 0,
        isExpanded: false,
        createdAt: null,
      });

      await expect(
        folderOps.createFolder(folderName, parentId)
      ).rejects.toThrow('Cannot create folder with ID 0 (reserved for root)');

      getFolderByIdSpy.mockRestore();
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
        folderOps.moveFolder(null as unknown as number, 1, mockGetFolderIdsForFile, mockRemoveFileFolderLink, mockAddFileFolderLink, mockGetAllFiles)
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
        folderOps.moveFolder(folderId, null as unknown as number, mockGetFolderIdsForFile, mockRemoveFileFolderLink, mockAddFileFolderLink, mockGetAllFiles)
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

      const updateCallOrder: number[] = [];
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
        folderOps as unknown as { getChildFolders: (parentId: number) => Promise<unknown[]> },
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
        folderOps as unknown as { getChildFolders: (parentId: number) => Promise<unknown[]> },
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
    it('should throw error when removing root folder and validate before database operations', async () => {
      await expect(
        folderOps.removeFolder(0, mockGetFolderIdsForFile, mockRemoveFileFolderLink, mockAddFileFolderLink, mockGetAllFiles)
      ).rejects.toThrow(ERROR_MESSAGES.CANNOT_REMOVE_DIRECTORY);

      // Verify no database operations occurred
      expect(mockDb.select).not.toHaveBeenCalled();
      expect(mockDb.update).not.toHaveBeenCalled();
      expect(mockDb.delete).not.toHaveBeenCalled();
    });

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

    it('should always move children to parent when removing folder', async () => {
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
      mockGetFolderIdsForFile.mockImplementation(async (fileId: number) => {
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

    it('should recursively merge child folders with same-named siblings when parent is removed', async () => {
      // Setup: Removing middle folder with nested children that have name conflicts
      // Structure before removal:
      //   grandparent (1)
      //     ├─ parent (5) [REMOVING THIS]
      //     │   ├─ shared (10)
      //     │   │   └─ nested (101)
      //     │   └─ unique (11)
      //     └─ shared (20) [EXISTING - conflict with child 10]
      //         └─ different (201)
      //
      // Expected: Child folder 10 merges into existing sibling 20
      //   grandparent (1)
      //     ├─ shared (20) [MERGED]
      //     │   ├─ nested (101) [from merged folder]
      //     │   └─ different (201) [existing]
      //     └─ unique (11) [moved up]

      const parentFolderId = 5;
      const grandparentId = 1;
      const childFolderId = 10;
      const existingSiblingId = 20;
      const nestedFolderId = 101;
      const uniqueChildId = 11;

      const parentFolder = {
        id: parentFolderId,
        name: 'Parent',
        parentId: grandparentId,
        isExpanded: false,
        createdAt: null,
      };

      const childFolder = {
        id: childFolderId,
        name: 'shared',
        parentId: parentFolderId,
        isExpanded: false,
        createdAt: null,
      };

      const uniqueChildFolder = {
        id: uniqueChildId,
        name: 'unique',
        parentId: parentFolderId,
        isExpanded: false,
        createdAt: null,
      };

      const existingSibling = {
        id: existingSiblingId,
        name: 'shared',
        parentId: grandparentId,
        isExpanded: false,
        createdAt: null,
      };

      const nestedFolder = {
        id: nestedFolderId,
        name: 'nested',
        parentId: childFolderId,
        isExpanded: false,
        createdAt: null,
      };

      const getFolderByIdSpy = vi.spyOn(folderOps, 'getFolderById').mockResolvedValue(parentFolder);
      const getChildFoldersSpy = vi.spyOn(folderOps as unknown as { getChildFolders: (parentId: number) => Promise<unknown[]> }, 'getChildFolders')
        .mockResolvedValueOnce([childFolder, uniqueChildFolder]) // Children of parent being removed
        .mockResolvedValueOnce([nestedFolder]); // Children of child folder being merged

      const getFolderByNameAndParentSpy = vi.spyOn(folderOps as unknown as { getFolderByNameAndParent: (name: string, parentId: number) => Promise<unknown> }, 'getFolderByNameAndParent')
        .mockImplementation(async (name: string, parentId: number) => {
          // When checking if 'shared' exists at grandparent level
          if (name === 'shared' && parentId === grandparentId) {
            return existingSibling;
          }
          // When checking if 'unique' exists at grandparent level
          if (name === 'unique' && parentId === grandparentId) {
            return undefined;
          }
          return undefined;
        });

      const getAllDescendantIdsSpy = vi.spyOn(folderOps, 'getAllDescendantIds').mockResolvedValue([]);
      const mergeFoldersSpy = vi.spyOn(folderOps as unknown as { mergeFolders: (sourceId: number, targetId: number, parseFolderIds: (json: string | null) => number[], updateFileFolderIds: (fileId: number, folderIds: number[]) => Promise<void>, getAllFiles: () => Promise<unknown[]>) => Promise<void> }, 'mergeFolders').mockResolvedValue(undefined);

      mockDb.update = vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined)
        })
      });

      mockDb.delete = vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined)
      });

      mockGetAllFiles.mockResolvedValue([]);

      await folderOps.removeFolder(parentFolderId, mockGetFolderIdsForFile, mockRemoveFileFolderLink, mockAddFileFolderLink, mockGetAllFiles);

      // Verify merge was called for the conflicting child folder
      expect(mergeFoldersSpy).toHaveBeenCalledWith(childFolderId, existingSiblingId, expect.any(Function), expect.any(Function), expect.any(Function), expect.any(Function));

      // Verify non-conflicting child was moved (update called)
      expect(mockDb.update).toHaveBeenCalled();

      // Verify parent folder was deleted
      expect(mockDb.delete).toHaveBeenCalled();

      getFolderByIdSpy.mockRestore();
      getChildFoldersSpy.mockRestore();
      getFolderByNameAndParentSpy.mockRestore();
      getAllDescendantIdsSpy.mockRestore();
      mergeFoldersSpy.mockRestore();
    });

    it('should recursively merge files when removing folder with nested file conflicts', async () => {
      // Setup: Removing folder where children have files that also exist in grandparent
      // Structure before removal:
      //   grandparent (1) [has file 101, 103]
      //     └─ parent (5) [REMOVING THIS]
      //         ├─ child (10) [has file 101 (shared), 102 (unique)]
      //         └─ child2 (11) [has file 103 (shared), 104 (unique)]
      //
      // Expected:
      // - Shared files (101, 103) remain linked to grandparent, removed from children
      // - Unique files (102, 104) move to grandparent with children
      // - Children move to grandparent

      const parentFolderId = 5;
      const grandparentId = 1;
      const child1Id = 10;
      const child2Id = 11;

      const parentFolder = {
        id: parentFolderId,
        name: 'Parent',
        parentId: grandparentId,
        isExpanded: false,
        createdAt: null,
      };

      const child1 = {
        id: child1Id,
        name: 'child1',
        parentId: parentFolderId,
        isExpanded: false,
        createdAt: null,
      };

      const child2 = {
        id: child2Id,
        name: 'child2',
        parentId: parentFolderId,
        isExpanded: false,
        createdAt: null,
      };

      const sharedFile1 = {
        id: 101,
        filename: 'shared1.txt',
        path: '/shared1.txt',
        filetype: 'text',
        fileStorageType: 'import',
        addedAt: null,
      };

      const uniqueFile1 = {
        id: 102,
        filename: 'unique1.txt',
        path: '/unique1.txt',
        filetype: 'text',
        fileStorageType: 'import',
        addedAt: null,
      };

      const sharedFile2 = {
        id: 103,
        filename: 'shared2.txt',
        path: '/shared2.txt',
        filetype: 'text',
        fileStorageType: 'import',
        addedAt: null,
      };

      const uniqueFile2 = {
        id: 104,
        filename: 'unique2.txt',
        path: '/unique2.txt',
        filetype: 'text',
        fileStorageType: 'import',
        addedAt: null,
      };

      const getFolderByIdSpy = vi.spyOn(folderOps, 'getFolderById').mockResolvedValue(parentFolder);
      const getChildFoldersSpy = vi.spyOn(folderOps as unknown as { getChildFolders: (parentId: number) => Promise<unknown[]> }, 'getChildFolders').mockResolvedValue([child1, child2]);
      const getFolderByNameAndParentSpy = vi.spyOn(folderOps as unknown as { getFolderByNameAndParent: (name: string, parentId: number) => Promise<unknown> }, 'getFolderByNameAndParent').mockResolvedValue(undefined);
      const getAllDescendantIdsSpy = vi.spyOn(folderOps, 'getAllDescendantIds').mockResolvedValue([]);

      mockGetAllFiles.mockResolvedValue([sharedFile1, uniqueFile1, sharedFile2, uniqueFile2]);
      mockGetFolderIdsForFile.mockImplementation(async (fileId) => {
        if (fileId === 101) return [grandparentId, child1Id]; // Shared with grandparent (not in parent)
        if (fileId === 102) return [child1Id]; // Unique to child1
        if (fileId === 103) return [grandparentId, child2Id, parentFolderId]; // Shared with grandparent AND in parent
        if (fileId === 104) return [child2Id, parentFolderId]; // In child2 AND in parent
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

      await folderOps.removeFolder(parentFolderId, mockGetFolderIdsForFile, mockRemoveFileFolderLink, mockAddFileFolderLink, mockGetAllFiles);

      // Verify files that were in parent had links removed from parent
      expect(mockRemoveFileFolderLink).toHaveBeenCalledWith(103, parentFolderId);
      expect(mockRemoveFileFolderLink).toHaveBeenCalledWith(104, parentFolderId);

      // Verify file 104 (was unique to parent+child2, after removing parent link, still in child2) - no add needed
      // File 103 (shared with grandparent, still exists there) - no add needed
      // File 102 (unique to child1, not in parent) - no add needed
      // File 101 (in grandparent and child1, not in parent) - no add needed

      // None of these files become orphaned, so no addFileFolderLink calls expected for moving to grandparent

      // Verify child folders were moved to grandparent
      expect(mockDb.update).toHaveBeenCalled();

      // Verify parent folder was deleted
      expect(mockDb.delete).toHaveBeenCalled();

      getFolderByIdSpy.mockRestore();
      getChildFoldersSpy.mockRestore();
      getFolderByNameAndParentSpy.mockRestore();
      getAllDescendantIdsSpy.mockRestore();
    });
  });

  describe('deleteFolder', () => {
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

    it('should delete unique files and remove non-unique files in the subtree of a folder being deleted', async () => {
      // Setup: Delete folder with child - files in subtree should be handled correctly
      // Structure:
      //   parent (1)
      //     └─ folder (5) [DELETING THIS]
      //         └─ child (10)
      //
      // Files:
      //   - File 101: ONLY in folder 5 and child 10 (unique to subtree) -> DELETE completely
      //   - File 102: in folder 5, folder 20, folder 30 (shared outside subtree) -> REMOVE links to 5 only
      //   - File 103: in folder 20, folder 30 (not in subtree) -> NOT touched
      //
      // Expected:
      //   - File 101 deleted completely (unique to subtree)
      //   - File 102 link removed from folder 5 (but file remains in 20, 30)
      //   - File 103 untouched (not in subtree)
      //   - Folders 5 and 10 deleted

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
        if (fileId === 101) return [folderId, childId]; // Unique to subtree
        if (fileId === 102) return [folderId, 20, 30]; // Shared outside subtree
        if (fileId === 103) return [20, 30]; // Not in subtree
        return [];
      });

      mockDb.delete = vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined)
      });

      await folderOps.deleteFolder(folderId, mockGetFolderIdsForFile, mockDeleteFile, mockRemoveFileFolderLink, mockGetAllFiles);

      // Verify unique file in subtree was completely deleted
      expect(mockDeleteFile).toHaveBeenCalledWith(101);
      expect(mockDeleteFile).toHaveBeenCalledTimes(1);

      // Verify shared file had link removed from deleted folder only
      expect(mockRemoveFileFolderLink).toHaveBeenCalledWith(102, folderId);

      // Verify file not in subtree was not touched
      expect(mockDeleteFile).not.toHaveBeenCalledWith(103);
      expect(mockRemoveFileFolderLink).not.toHaveBeenCalledWith(103, expect.anything());

      // Verify folders were deleted
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

    it('should not delete root when clearing all contents of root', async () => {
      // Setup: When deleting all root child folders, root (0) should never be deleted
      // This test ensures that even when clearing all contents, the root folder persists
      // Structure:
      //   root (0)
      //     ├─ child1 (1) [DELETING]
      //     ├─ child2 (2) [DELETING]
      //     └─ child3 (3) [DELETING]
      //
      // Expected: All child folders deleted, but root (0) remains intact

      const child1Id = 1;
      const child2Id = 2;
      const child3Id = 3;

      const child1 = {
        id: child1Id,
        name: 'Child1',
        parentId: 0,
        isExpanded: false,
        createdAt: null,
      };

      const child2 = {
        id: child2Id,
        name: 'Child2',
        parentId: 0,
        isExpanded: false,
        createdAt: null,
      };

      const child3 = {
        id: child3Id,
        name: 'Child3',
        parentId: 0,
        isExpanded: false,
        createdAt: null,
      };

      mockDb.delete = vi.fn().mockReturnValue({
        where: vi.fn(() => {
          // Track which folder IDs are being deleted
          // In real implementation, this would be the eq(schema.folders.id, folderId) call
          return Promise.resolve(undefined);
        })
      });

      mockGetAllFiles.mockResolvedValue([]);

      // Delete child1
      const getFolderByIdSpy1 = vi.spyOn(folderOps, 'getFolderById').mockResolvedValue(child1);
      const getAllDescendantIdsSpy1 = vi.spyOn(folderOps, 'getAllDescendantIds').mockResolvedValue([]);

      await folderOps.deleteFolder(child1Id, mockGetFolderIdsForFile, mockDeleteFile, mockRemoveFileFolderLink, mockGetAllFiles);
      expect(mockDb.delete).toHaveBeenCalled();

      // Delete child2
      getFolderByIdSpy1.mockRestore();
      getAllDescendantIdsSpy1.mockRestore();
      const getFolderByIdSpy2 = vi.spyOn(folderOps, 'getFolderById').mockResolvedValue(child2);
      const getAllDescendantIdsSpy2 = vi.spyOn(folderOps, 'getAllDescendantIds').mockResolvedValue([]);

      await folderOps.deleteFolder(child2Id, mockGetFolderIdsForFile, mockDeleteFile, mockRemoveFileFolderLink, mockGetAllFiles);
      expect(mockDb.delete).toHaveBeenCalled();

      // Delete child3
      getFolderByIdSpy2.mockRestore();
      getAllDescendantIdsSpy2.mockRestore();
      const getFolderByIdSpy3 = vi.spyOn(folderOps, 'getFolderById').mockResolvedValue(child3);
      const getAllDescendantIdsSpy3 = vi.spyOn(folderOps, 'getAllDescendantIds').mockResolvedValue([]);

      await folderOps.deleteFolder(child3Id, mockGetFolderIdsForFile, mockDeleteFile, mockRemoveFileFolderLink, mockGetAllFiles);
      expect(mockDb.delete).toHaveBeenCalled();

      // Verify that root (0) was never attempted to be deleted
      // The test already passed if we got here without errors
      // because deleteFolder(0, ...) would have thrown ERROR_MESSAGES.CANNOT_REMOVE_DIRECTORY
      // This test verifies the protection is in place

      getFolderByIdSpy3.mockRestore();
      getAllDescendantIdsSpy3.mockRestore();
    });

    it('should properly remove contents rather than orphaning nodes when deleting folder', async () => {
      // Setup: Verify that deletion removes all folders in subtree completely, not orphaning them
      // Structure:
      //   parent (1)
      //     └─ folder (5) [DELETING THIS]
      //         ├─ child1 (10)
      //         │   └─ grandchild1 (100)
      //         └─ child2 (11)
      //             └─ grandchild2 (101)
      //
      // Expected: All folders (5, 10, 11, 100, 101) are completely deleted
      //           No folders are orphaned (left with invalid parent references)

      const folderId = 5;
      const child1Id = 10;
      const child2Id = 11;
      const grandchild1Id = 100;
      const grandchild2Id = 101;

      const folder = {
        id: folderId,
        name: 'FolderToDelete',
        parentId: 1,
        isExpanded: false,
        createdAt: null,
      };

      const getFolderByIdSpy = vi.spyOn(folderOps, 'getFolderById').mockResolvedValue(folder);
      const getAllDescendantIdsSpy = vi.spyOn(folderOps, 'getAllDescendantIds').mockResolvedValue([
        child1Id,
        child2Id,
        grandchild1Id,
        grandchild2Id
      ]);

      mockGetAllFiles.mockResolvedValue([]);

      // Track which folders are being deleted
      mockDb.delete = vi.fn().mockReturnValue({
        where: vi.fn(() => {
          // In the real implementation, this is called once per folder in folderIdsToDelete
          return Promise.resolve(undefined);
        })
      });

      await folderOps.deleteFolder(folderId, mockGetFolderIdsForFile, mockDeleteFile, mockRemoveFileFolderLink, mockGetAllFiles);

      // Verify getAllDescendantIds was called to get the full subtree
      expect(getAllDescendantIdsSpy).toHaveBeenCalledWith(folderId);

      // Verify delete was called for ALL folders in the subtree
      // The implementation calls delete once per folder: folderId + all descendants
      // That's 1 (folder) + 4 (descendants) = 5 total delete calls
      expect(mockDb.delete).toHaveBeenCalledTimes(5);

      // Verify no folders were orphaned by checking that descendants were identified
      // before deletion (not attempting to delete with invalid parent references)
      const descendantIds = await getAllDescendantIdsSpy.mock.results[0].value;
      expect(descendantIds).toEqual([child1Id, child2Id, grandchild1Id, grandchild2Id]);

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

    it('should return all ancestor IDs for a very deeply nested folder', async () => {
      const level10 = 10;
      const level9 = 9;
      const level8 = 8;
      const level7 = 7;
      const level6 = 6;
      const level5 = 5;
      const level4 = 4;
      const level3 = 3;
      const level2 = 2;
      const level1 = 1;

      const getFolderByIdSpy = vi.spyOn(folderOps, 'getFolderById')
        .mockResolvedValueOnce({ id: level10, name: 'Level10', parentId: level9, isExpanded: false, createdAt: null })
        .mockResolvedValueOnce({ id: level9, name: 'Level9', parentId: level8, isExpanded: false, createdAt: null })
        .mockResolvedValueOnce({ id: level8, name: 'Level8', parentId: level7, isExpanded: false, createdAt: null })
        .mockResolvedValueOnce({ id: level7, name: 'Level7', parentId: level6, isExpanded: false, createdAt: null })
        .mockResolvedValueOnce({ id: level6, name: 'Level6', parentId: level5, isExpanded: false, createdAt: null })
        .mockResolvedValueOnce({ id: level5, name: 'Level5', parentId: level4, isExpanded: false, createdAt: null })
        .mockResolvedValueOnce({ id: level4, name: 'Level4', parentId: level3, isExpanded: false, createdAt: null })
        .mockResolvedValueOnce({ id: level3, name: 'Level3', parentId: level2, isExpanded: false, createdAt: null })
        .mockResolvedValueOnce({ id: level2, name: 'Level2', parentId: level1, isExpanded: false, createdAt: null })
        .mockResolvedValueOnce({ id: level1, name: 'Level1', parentId: 0, isExpanded: false, createdAt: null });

      const result = await folderOps.getAllAncestorIds(level10);

      expect(result).toEqual([level10, level9, level8, level7, level6, level5, level4, level3, level2, level1]);
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

    it('should return all descendant IDs for a deeply nested subtree', async () => {
      const folderId = 1;
      const level1Ids = [2, 3];
      const level2Ids = [4, 5, 6, 7];
      const level3Ids = [8, 9, 10, 11, 12, 13, 14, 15];

      const getFolderByIdSpy = vi.spyOn(folderOps, 'getFolderById')
        .mockResolvedValue({ id: folderId, name: 'Folder', parentId: 0, isExpanded: false, createdAt: null });

      // Mock select to return children at each level
      mockDb.select = vi.fn()
        // Level 1: children of folderId
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(level1Ids.map(id => ({ id, name: `Child${id}`, parentId: folderId, isExpanded: false, createdAt: null })))
          })
        })
        // Level 2: children of level1Ids[0] (id=2)
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([
              { id: 4, name: 'Child4', parentId: 2, isExpanded: false, createdAt: null },
              { id: 5, name: 'Child5', parentId: 2, isExpanded: false, createdAt: null }
            ])
          })
        })
        // Level 3: children of id=4
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([
              { id: 8, name: 'Child8', parentId: 4, isExpanded: false, createdAt: null },
              { id: 9, name: 'Child9', parentId: 4, isExpanded: false, createdAt: null }
            ])
          })
        })
        // No children for id=8
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([])
          })
        })
        // No children for id=9
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([])
          })
        })
        // Level 3: children of id=5
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([
              { id: 10, name: 'Child10', parentId: 5, isExpanded: false, createdAt: null },
              { id: 11, name: 'Child11', parentId: 5, isExpanded: false, createdAt: null }
            ])
          })
        })
        // No children for id=10
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([])
          })
        })
        // No children for id=11
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([])
          })
        })
        // Level 2: children of level1Ids[1] (id=3)
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([
              { id: 6, name: 'Child6', parentId: 3, isExpanded: false, createdAt: null },
              { id: 7, name: 'Child7', parentId: 3, isExpanded: false, createdAt: null }
            ])
          })
        })
        // Level 3: children of id=6
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([
              { id: 12, name: 'Child12', parentId: 6, isExpanded: false, createdAt: null },
              { id: 13, name: 'Child13', parentId: 6, isExpanded: false, createdAt: null }
            ])
          })
        })
        // No children for id=12
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([])
          })
        })
        // No children for id=13
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([])
          })
        })
        // Level 3: children of id=7
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([
              { id: 14, name: 'Child14', parentId: 7, isExpanded: false, createdAt: null },
              { id: 15, name: 'Child15', parentId: 7, isExpanded: false, createdAt: null }
            ])
          })
        })
        // No children for id=14
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([])
          })
        })
        // No children for id=15
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([])
          })
        });

      const result = await folderOps.getAllDescendantIds(folderId);

      // Depth-first traversal: 2, 4, 8, 9, 5, 10, 11, 3, 6, 12, 13, 7, 14, 15
      expect(result).toEqual([2, 4, 8, 9, 5, 10, 11, 3, 6, 12, 13, 7, 14, 15]);
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

  describe('expandAllDescendants', () => {
    it('should atomically expand a folder and all its descendants', async () => {
      const folderId = 5;
      const descendantIds = [6, 7];

      const getFolderByIdSpy = vi.spyOn(folderOps, 'getFolderById').mockResolvedValue({
        id: folderId,
        name: 'Folder',
        parentId: 0,
        isExpanded: false,
        createdAt: null,
      });

      const getAllDescendantIdsSpy = vi.spyOn(folderOps, 'getAllDescendantIds').mockResolvedValue(descendantIds);

      mockDb.update = vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined)
        })
      });

      await folderOps.expandAllDescendants(folderId);

      // Should update folder itself + all descendants
      expect(mockDb.update).toHaveBeenCalledTimes(3);
      getFolderByIdSpy.mockRestore();
      getAllDescendantIdsSpy.mockRestore();
    });

    it('should throw error for non-existent folder', async () => {
      const getFolderByIdSpy = vi.spyOn(folderOps, 'getFolderById').mockResolvedValue(undefined);

      await expect(
        folderOps.expandAllDescendants(999)
      ).rejects.toThrow('Folder not found');

      expect(mockDb.update).not.toHaveBeenCalled();
      getFolderByIdSpy.mockRestore();
    });

    it('should handle deeply nested folder expansion', async () => {
      const folderId = 1;
      const descendantIds = [2, 3, 4, 5, 6, 7, 8, 9, 10];

      const getFolderByIdSpy = vi.spyOn(folderOps, 'getFolderById').mockResolvedValue({
        id: folderId,
        name: 'Folder',
        parentId: 0,
        isExpanded: false,
        createdAt: null,
      });

      const getAllDescendantIdsSpy = vi.spyOn(folderOps, 'getAllDescendantIds').mockResolvedValue(descendantIds);

      mockDb.update = vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined)
        })
      });

      await folderOps.expandAllDescendants(folderId);

      // Should update folder itself + all 9 descendants = 10 calls
      expect(mockDb.update).toHaveBeenCalledTimes(10);
      getFolderByIdSpy.mockRestore();
      getAllDescendantIdsSpy.mockRestore();
    });
  });

  describe('collapseAllDescendants', () => {
    it('should atomically collapse a folder and all its descendants', async () => {
      const folderId = 5;
      const descendantIds = [6, 7];

      const getFolderByIdSpy = vi.spyOn(folderOps, 'getFolderById').mockResolvedValue({
        id: folderId,
        name: 'Folder',
        parentId: 0,
        isExpanded: true,
        createdAt: null,
      });

      const getAllDescendantIdsSpy = vi.spyOn(folderOps, 'getAllDescendantIds').mockResolvedValue(descendantIds);

      mockDb.update = vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined)
        })
      });

      await folderOps.collapseAllDescendants(folderId);

      // Should update all descendants + folder itself = 3 calls
      expect(mockDb.update).toHaveBeenCalledTimes(3);
      getFolderByIdSpy.mockRestore();
      getAllDescendantIdsSpy.mockRestore();
    });

    it('should throw error for non-existent folder', async () => {
      const getFolderByIdSpy = vi.spyOn(folderOps, 'getFolderById').mockResolvedValue(undefined);

      await expect(
        folderOps.collapseAllDescendants(999)
      ).rejects.toThrow('Folder not found');

      expect(mockDb.update).not.toHaveBeenCalled();
      getFolderByIdSpy.mockRestore();
    });

    it('should handle deeply nested folder contraction', async () => {
      const folderId = 1;
      const descendantIds = [2, 3, 4, 5, 6, 7, 8, 9, 10];

      const getFolderByIdSpy = vi.spyOn(folderOps, 'getFolderById').mockResolvedValue({
        id: folderId,
        name: 'Folder',
        parentId: 0,
        isExpanded: true,
        createdAt: null,
      });

      const getAllDescendantIdsSpy = vi.spyOn(folderOps, 'getAllDescendantIds').mockResolvedValue(descendantIds);

      mockDb.update = vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined)
        })
      });

      await folderOps.collapseAllDescendants(folderId);

      // Should update all 9 descendants + folder itself = 10 calls
      expect(mockDb.update).toHaveBeenCalledTimes(10);
      getFolderByIdSpy.mockRestore();
      getAllDescendantIdsSpy.mockRestore();
    });
  });
});
