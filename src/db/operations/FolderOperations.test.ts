import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FolderOperations } from './FolderOperations';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../schema';
import { ERROR_MESSAGES } from '../../config/constants';

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

  const mockGetAllFiles = vi.fn(async () => {
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

  describe('Root Folder Protection', () => {
    describe('Move Operations', () => {
    /**
     * Test root protection across multiple different destination IDs
     * Including moving to itself (0), positive IDs, and negative IDs
     */
    it('should throw error when moving root to any destination', async () => {
      const destinations = [0, 1, 5, 10, 100, 999, -1, -999];

      for (const destId of destinations) {
        await expect(
          folderOps.moveFolder(0, destId, mockParseFolderIds, mockUpdateFileFolderIds, mockGetAllFiles)
        ).rejects.toThrow(ERROR_MESSAGES.CANNOT_MOVE_DIRECTORY);
      }
    });

    /**
     * Verify protection happens before ANY database operations
     * This ensures the check is not fragile or corrected after the fact
     */
    it('should reject root move before executing database operations', async () => {
      try {
        await folderOps.moveFolder(0, 1, mockParseFolderIds, mockUpdateFileFolderIds, mockGetAllFiles);
      } catch {
        // Expected to throw
      }

      // Database should never be touched
      expect(mockDb.select).not.toHaveBeenCalled();
      expect(mockDb.update).not.toHaveBeenCalled();
      expect(mockDb.delete).not.toHaveBeenCalled();
    });
    });

    describe('Remove Operations', () => {
    /**
     * Core protection: Root folder (ID=0) cannot be removed
     *
     * removeFolder moves children to parent folder. For root, there is no
     * parent to move children to, so the operation is blocked.
     */
    it('should throw error when attempting to remove root folder', async () => {
      await expect(
        folderOps.removeFolder(0, mockParseFolderIds, mockUpdateFileFolderIds, mockGetAllFiles)
      ).rejects.toThrow(ERROR_MESSAGES.CANNOT_REMOVE_DIRECTORY);
    });

    /**
     * Verify protection happens before ANY database operations
     * This ensures the check is not fragile or corrected after the fact
     */
    it('should reject root removal before executing database operations', async () => {
      try {
        await folderOps.removeFolder(0, mockParseFolderIds, mockUpdateFileFolderIds, mockGetAllFiles);
      } catch {
        // Expected to throw
      }

      // Database should never be touched
      expect(mockDb.select).not.toHaveBeenCalled();
      expect(mockDb.update).not.toHaveBeenCalled();
      expect(mockDb.delete).not.toHaveBeenCalled();
    });
    });

    describe('Delete Operations', () => {
      /**
       * Core protection: Root folder (ID=0) cannot be deleted
       *
       * deleteFolder cascade deletes all subfolders and unique files.
       * For root, this would delete the entire folder structure, so it's blocked.
       */
      it('should throw error when attempting to delete root folder', async () => {
      await expect(
        folderOps.deleteFolder(0, mockParseFolderIds, mockDeleteFile, mockUpdateFileFolderIds, mockGetAllFiles)
      ).rejects.toThrow(ERROR_MESSAGES.CANNOT_REMOVE_DIRECTORY);
    });

    /**
     * Verify protection happens before ANY database operations
     * This ensures the check is not fragile or corrected after the fact
     */
    it('should reject root deletion before executing database operations', async () => {
      try {
        await folderOps.deleteFolder(0, mockParseFolderIds, mockDeleteFile, mockUpdateFileFolderIds, mockGetAllFiles);
      } catch {
        // Expected to throw
      }

      // Database should never be touched
      expect(mockDb.select).not.toHaveBeenCalled();
      expect(mockDb.update).not.toHaveBeenCalled();
      expect(mockDb.delete).not.toHaveBeenCalled();
      expect(mockDeleteFile).not.toHaveBeenCalled();
    });
    });

    describe('Validation Precedence', () => {
      /**
       * Root protection must take absolute precedence over all other validations
       * This ensures it's not fragile or dependent on other validation logic
       */
      it('should check root protection before any other validation', async () => {
        // Even with completely invalid parameters, root check happens first
        await expect(
          folderOps.moveFolder(0, -999, mockParseFolderIds, mockUpdateFileFolderIds, mockGetAllFiles)
        ).rejects.toThrow(ERROR_MESSAGES.CANNOT_MOVE_DIRECTORY);
      });

      /**
       * Verify root folder ID is exactly 0
       */
      it('should recognize 0 and only 0 as the root folder ID', async () => {
        // ID 0 should fail
        await expect(
          folderOps.moveFolder(0, 1, mockParseFolderIds, mockUpdateFileFolderIds, mockGetAllFiles)
        ).rejects.toThrow(ERROR_MESSAGES.CANNOT_MOVE_DIRECTORY);

        // Set up mock to allow non-root folder operations to proceed past root check
        mockDb.select = vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([{
                id: 1,
                name: 'TestFolder',
                parentId: 0,
                isExpanded: false,
              }])
            })
          })
        });

        // ID 1 should NOT trigger root protection error (will fail for other reasons)
        try {
          await folderOps.moveFolder(1, 2, mockParseFolderIds, mockUpdateFileFolderIds, mockGetAllFiles);
        } catch (error) {
          if (error instanceof Error) {
            expect(error.message).not.toBe(ERROR_MESSAGES.CANNOT_MOVE_DIRECTORY);
          }
        }
      });

      /**
       * Error messages must be constant and not constructed on-the-fly
       * This ensures consistency and prevents fragile string matching
       */
      it('should use constant error messages', async () => {
      // Test move error
      try {
        await folderOps.moveFolder(0, 1, mockParseFolderIds, mockUpdateFileFolderIds, mockGetAllFiles);
      } catch (error) {
        if (error instanceof Error) {
          expect(error.message).toBe(ERROR_MESSAGES.CANNOT_MOVE_DIRECTORY);
        }
      }

      // Test remove error
      try {
        await folderOps.removeFolder(0, mockParseFolderIds, mockUpdateFileFolderIds, mockGetAllFiles);
      } catch (error) {
        if (error instanceof Error) {
          expect(error.message).toBe(ERROR_MESSAGES.CANNOT_REMOVE_DIRECTORY);
        }
      }

      // Test delete error
      try {
        await folderOps.deleteFolder(0, mockParseFolderIds, mockDeleteFile, mockUpdateFileFolderIds, mockGetAllFiles);
      } catch (error) {
        if (error instanceof Error) {
          expect(error.message).toBe(ERROR_MESSAGES.CANNOT_REMOVE_DIRECTORY);
        }
      }
    });
    });
  });

  describe('Move Operations', () => {
    describe('Invalid Moves', () => {
      it('should throw error when moving folder to itself', async () => {
        await expect(
          folderOps.moveFolder(5, 5, mockParseFolderIds, mockUpdateFileFolderIds, mockGetAllFiles)
        ).rejects.toThrow('Cannot move folder to itself');
      });

      it('should reject move to itself before executing database operations', async () => {
        try {
          await folderOps.moveFolder(5, 5, mockParseFolderIds, mockUpdateFileFolderIds, mockGetAllFiles);
        } catch {
          // Expected to throw
        }

        expect(mockDb.select).not.toHaveBeenCalled();
        expect(mockDb.update).not.toHaveBeenCalled();
        expect(mockDb.delete).not.toHaveBeenCalled();
      });

      it('should throw error when moving folder to its own descendant', async () => {
        const getFolderByIdSpy = vi.spyOn(folderOps, 'getFolderById').mockResolvedValue({
          id: 1,
          name: 'Folder',
          parentId: 0,
          isExpanded: false,
        });

        const isDescendantOfSpy = vi.spyOn(folderOps as any, 'isDescendantOf').mockResolvedValue(true);

        await expect(
          folderOps.moveFolder(1, 10, mockParseFolderIds, mockUpdateFileFolderIds, mockGetAllFiles)
        ).rejects.toThrow('Cannot move folder to its own descendant');

        getFolderByIdSpy.mockRestore();
        isDescendantOfSpy.mockRestore();
      });

      it('should check move to itself before any other validation', async () => {
        await expect(
          folderOps.moveFolder(999, 999, mockParseFolderIds, mockUpdateFileFolderIds, mockGetAllFiles)
        ).rejects.toThrow('Cannot move folder to itself');

        expect(mockDb.select).not.toHaveBeenCalled();
      });

      it('should throw error when moving non-existent folder', async () => {
        const getFolderByIdSpy = vi.spyOn(folderOps, 'getFolderById').mockResolvedValue(undefined);

        await expect(
          folderOps.moveFolder(999, 1, mockParseFolderIds, mockUpdateFileFolderIds, mockGetAllFiles)
        ).rejects.toThrow('Folder not found');

        getFolderByIdSpy.mockRestore();
      });

      it('should throw error when moving folder to its current parent', async () => {
        const folderId = 5;
        const currentParentId = 10;

        const getFolderByIdSpy = vi.spyOn(folderOps, 'getFolderById').mockResolvedValue({
          id: folderId,
          name: 'Folder',
          parentId: currentParentId,
          isExpanded: false,
        });

        await expect(
          folderOps.moveFolder(folderId, currentParentId, mockParseFolderIds, mockUpdateFileFolderIds, mockGetAllFiles)
        ).rejects.toThrow('Folder is already in this location');

        getFolderByIdSpy.mockRestore();
      });
    });

    describe('Valid Moves', () => {
      it('should allow moving folder to non-descendant location', async () => {
        const getFolderByIdSpy = vi.spyOn(folderOps, 'getFolderById').mockResolvedValue({
          id: 5,
          name: 'Folder',
          parentId: 1,
          isExpanded: false,
        });

        mockDb.update = vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(undefined)
          })
        });

        const isDescendantOfSpy = vi.spyOn(folderOps as any, 'isDescendantOf').mockResolvedValue(false);
        const getFolderByNameAndParentSpy = vi.spyOn(folderOps as any, 'getFolderByNameAndParent').mockResolvedValue(undefined);

        await expect(
          folderOps.moveFolder(5, 10, mockParseFolderIds, mockUpdateFileFolderIds, mockGetAllFiles)
        ).resolves.not.toThrow();

        getFolderByIdSpy.mockRestore();
        isDescendantOfSpy.mockRestore();
        getFolderByNameAndParentSpy.mockRestore();
      });

      it('should allow moving folder to root level', async () => {
        const folderId = 5;
        const newParentId = 0;

        const getFolderByIdSpy = vi.spyOn(folderOps, 'getFolderById').mockResolvedValue({
          id: folderId,
          name: 'Folder',
          parentId: 10,
          isExpanded: false,
        });

        const getFolderByNameAndParentSpy = vi.spyOn(folderOps as any, 'getFolderByNameAndParent').mockResolvedValue(undefined);

        mockDb.update = vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(undefined)
          })
        });

        await expect(
          folderOps.moveFolder(folderId, newParentId, mockParseFolderIds, mockUpdateFileFolderIds, mockGetAllFiles)
        ).resolves.not.toThrow();

        expect(mockDb.update).toHaveBeenCalled();

        getFolderByIdSpy.mockRestore();
        getFolderByNameAndParentSpy.mockRestore();
      });

      it('should successfully move folder and update parentId', async () => {
        const folderId = 5;
        const oldParentId = 1;
        const newParentId = 2;

        const getFolderByIdSpy = vi.spyOn(folderOps, 'getFolderById').mockResolvedValue({
          id: folderId,
          name: 'Folder',
          parentId: oldParentId,
          isExpanded: false,
        });

        const isDescendantOfSpy = vi.spyOn(folderOps as any, 'isDescendantOf').mockResolvedValue(false);
        const getFolderByNameAndParentSpy = vi.spyOn(folderOps as any, 'getFolderByNameAndParent').mockResolvedValue(undefined);

        let capturedUpdate: any = null;
        mockDb.update = vi.fn().mockReturnValue({
          set: vi.fn((values: any) => {
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
    });

    describe('Merge on Move', () => {
      it('should merge folders when moving to parent with same-named child', async () => {
        const sourceFolderId = 5;
        const targetFolderId = 10;
        const newParentId = 2;

        const sourceFolder = {
          id: sourceFolderId,
          name: 'SharedName',
          parentId: 1,
          isExpanded: false,
        };

        const existingFolder = {
          id: targetFolderId,
          name: 'SharedName',
          parentId: newParentId,
          isExpanded: false,
        };

        const getFolderByIdSpy = vi.spyOn(folderOps, 'getFolderById').mockResolvedValue(sourceFolder);
        const getFolderByNameAndParentSpy = vi.spyOn(folderOps as any, 'getFolderByNameAndParent').mockResolvedValue(existingFolder);
        const isDescendantOfSpy = vi.spyOn(folderOps as any, 'isDescendantOf').mockResolvedValue(false);
        const getChildFoldersSpy = vi.spyOn(folderOps as any, 'getChildFolders').mockResolvedValue([]);

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
  });

  describe('Remove Operations', () => {
    describe('Folder Not Found', () => {
      it('should throw error when removing non-existent folder', async () => {
        const getFolderByIdSpy = vi.spyOn(folderOps, 'getFolderById').mockResolvedValue(undefined);

        await expect(
          folderOps.removeFolder(999, mockParseFolderIds, mockUpdateFileFolderIds, mockGetAllFiles)
        ).rejects.toThrow('Folder not found');

        getFolderByIdSpy.mockRestore();
      });
    });

    describe('Valid Remove', () => {
      it('should allow removing folder and move children to parent', async () => {
        const folderId = 5;
        const parentId = 1;
        const childId1 = 10;
        const childId2 = 11;

        const folder = {
          id: folderId,
          name: 'FolderToRemove',
          parentId: parentId,
          isExpanded: false,
        };

        const children = [
          { id: childId1, name: 'Child1', parentId: folderId, isExpanded: false },
          { id: childId2, name: 'Child2', parentId: folderId, isExpanded: false },
        ];

        const getFolderByIdSpy = vi.spyOn(folderOps, 'getFolderById').mockResolvedValue(folder);
        const getChildFoldersSpy = vi.spyOn(folderOps as any, 'getChildFolders').mockResolvedValue(children);
        const getFolderByNameAndParentSpy = vi.spyOn(folderOps as any, 'getFolderByNameAndParent').mockResolvedValue(undefined);
        const getAllDescendantIdsSpy = vi.spyOn(folderOps, 'getAllDescendantIds').mockResolvedValue([folderId]);

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

      it('should move children up without merge when no name conflict exists', async () => {
        const parentFolderId = 5;
        const grandparentId = 1;
        const childFolderId = 10;

        const parentFolder = {
          id: parentFolderId,
          name: 'Parent',
          parentId: grandparentId,
          isExpanded: false,
        };

        const childFolder = {
          id: childFolderId,
          name: 'UniqueName',
          parentId: parentFolderId,
          isExpanded: false,
        };

        const getFolderByIdSpy = vi.spyOn(folderOps, 'getFolderById').mockResolvedValue(parentFolder);
        const getChildFoldersSpy = vi.spyOn(folderOps as any, 'getChildFolders').mockResolvedValue([childFolder]);
        const getFolderByNameAndParentSpy = vi.spyOn(folderOps as any, 'getFolderByNameAndParent').mockResolvedValue(undefined);
        const getAllDescendantIdsSpy = vi.spyOn(folderOps, 'getAllDescendantIds').mockResolvedValue([parentFolderId]);

        mockDb.update = vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(undefined)
          })
        });

        mockDb.delete = vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined)
        });

        await folderOps.removeFolder(parentFolderId, mockParseFolderIds, mockUpdateFileFolderIds, mockGetAllFiles);

        expect(mockDb.update).toHaveBeenCalled();

        getFolderByIdSpy.mockRestore();
        getChildFoldersSpy.mockRestore();
        getFolderByNameAndParentSpy.mockRestore();
        getAllDescendantIdsSpy.mockRestore();
      });
    });

    describe('Merge on Parent Remove', () => {
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
        };

        const childFolder = {
          id: childFolderId,
          name: 'SharedName',
          parentId: parentFolderId,
          isExpanded: false,
        };

        const existingSibling = {
          id: existingSiblingId,
          name: 'SharedName',
          parentId: grandparentId,
          isExpanded: false,
        };

        const getFolderByIdSpy = vi.spyOn(folderOps, 'getFolderById').mockResolvedValue(parentFolder);
        const getChildFoldersSpy = vi.spyOn(folderOps as any, 'getChildFolders').mockResolvedValue([childFolder]);
        const getFolderByNameAndParentSpy = vi.spyOn(folderOps as any, 'getFolderByNameAndParent').mockResolvedValue(existingSibling);
        const getAllDescendantIdsSpy = vi.spyOn(folderOps, 'getAllDescendantIds').mockResolvedValue([parentFolderId]);
        const mergeFoldersSpy = vi.spyOn(folderOps as any, 'mergeFolders').mockResolvedValue(undefined);

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
  });

  describe('Delete Operations', () => {
    describe('Folder Not Found', () => {
      it('should throw error when deleting non-existent folder', async () => {
        const getFolderByIdSpy = vi.spyOn(folderOps, 'getFolderById').mockResolvedValue(undefined);

        await expect(
          folderOps.deleteFolder(999, mockParseFolderIds, mockDeleteFile, mockUpdateFileFolderIds, mockGetAllFiles)
        ).rejects.toThrow('Folder not found');

        getFolderByIdSpy.mockRestore();
      });
    });

    describe('Cascade Delete', () => {
      it('should cascade delete unique files and update non-unique files', async () => {
        const folderId = 5;
        const childId = 10;

        const folder = {
          id: folderId,
          name: 'FolderToDelete',
          parentId: 1,
          isExpanded: false,
        };

        const uniqueFile = {
          id: 101,
          filename: 'unique.txt',
          path: '/unique.txt',
          folderIds: JSON.stringify([folderId, childId]),
          filetype: 'text',
          fileStorageType: 'import',
        };

        const sharedFile = {
          id: 102,
          filename: 'shared.txt',
          path: '/shared.txt',
          folderIds: JSON.stringify([folderId, 20, 30]),
          filetype: 'text',
          fileStorageType: 'import',
        };

        const otherFile = {
          id: 103,
          filename: 'other.txt',
          path: '/other.txt',
          folderIds: JSON.stringify([20, 30]),
          filetype: 'text',
          fileStorageType: 'import',
        };

        const getFolderByIdSpy = vi.spyOn(folderOps, 'getFolderById').mockResolvedValue(folder);
        const getAllDescendantIdsSpy = vi.spyOn(folderOps, 'getAllDescendantIds').mockResolvedValue([folderId, childId]);

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
    });
  });

  describe('Creation Operations', () => {
    describe('Invalid Creation', () => {
      it('should throw error when creating folder with empty name', async () => {
        await expect(
          folderOps.createFolder('', 1)
        ).rejects.toThrow('Folder name cannot be empty');
      });

      it('should throw error when creating folder with whitespace-only name', async () => {
        await expect(
          folderOps.createFolder('   ', 1)
        ).rejects.toThrow('Folder name cannot be empty');

        await expect(
          folderOps.createFolder('\t\n  ', 1)
        ).rejects.toThrow('Folder name cannot be empty');
      });

      it('should throw error when creating folder with duplicate name in same parent', async () => {
        const parentId = 1;
        const folderName = 'ExistingFolder';

        mockDb.select = vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([
              { id: 10, name: folderName, parentId: parentId, isExpanded: false }
            ])
          })
        });

        await expect(
          folderOps.createFolder(folderName, parentId)
        ).rejects.toThrow('A folder with this name already exists at this level');
      });
    });

    describe('Valid Creation', () => {
      it('should allow creating folder with valid name', async () => {
        const folderName = 'NewFolder';
        const parentId = 1;

        mockDb.select = vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([])
          })
        });

        mockDb.insert = vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([
              { id: 20, name: folderName, parentId: parentId, isExpanded: false }
            ])
          })
        });

        const expandAncestorFoldersSpy = vi.spyOn(folderOps, 'expandAncestorFolders').mockResolvedValue(undefined);

        const result = await folderOps.createFolder(folderName, parentId);

        expect(result).toBeDefined();
        expect(result.name).toBe(folderName);
        expect(result.parentId).toBe(parentId);

        expandAncestorFoldersSpy.mockRestore();
      });

      it('should allow creating folder with same name in different parent', async () => {
        const folderName = 'CommonName';
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
              { id: 30, name: folderName, parentId: parentId2, isExpanded: false }
            ])
          })
        });

        const expandAncestorFoldersSpy = vi.spyOn(folderOps, 'expandAncestorFolders').mockResolvedValue(undefined);

        const result1 = await folderOps.createFolder(folderName, parentId1);
        expect(result1.name).toBe(folderName);

        const result2 = await folderOps.createFolder(folderName, parentId2);
        expect(result2.name).toBe(folderName);

        expandAncestorFoldersSpy.mockRestore();
      });
    });
  });

  describe('Toggle Folder Expanded', () => {
    it('should toggle folder expansion state', async () => {
      const folderId = 5;

      const getFolderByIdSpy = vi.spyOn(folderOps, 'getFolderById').mockResolvedValue({
        id: folderId,
        name: 'Folder',
        parentId: 0,
        isExpanded: false,
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

    it('should throw error when toggling non-existent folder', async () => {
      const folderId = 999;

      const getFolderByIdSpy = vi.spyOn(folderOps, 'getFolderById').mockResolvedValue(undefined);

      await expect(
        folderOps.toggleFolderExpanded(folderId)
      ).rejects.toThrow('Folder not found');

      getFolderByIdSpy.mockRestore();
    });
  });

  describe('Expand Ancestor Folders', () => {
    it('should expand all ancestor folders for a given folder', async () => {
      const folderId = 10;
      const parentFolder = { id: 5, name: 'Parent', parentId: 0, isExpanded: false };

      const getFolderByIdSpy = vi.spyOn(folderOps, 'getFolderById')
        .mockResolvedValueOnce({ id: folderId, name: 'Child', parentId: 5, isExpanded: false })
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
        .mockResolvedValueOnce({ id: folderId, name: 'Root', parentId: 0, isExpanded: false });

      await folderOps.expandAncestorFolders(folderId);

      expect(getFolderByIdSpy).toHaveBeenCalledWith(folderId);
      getFolderByIdSpy.mockRestore();
    });

    it('should handle already-expanded folder (idempotence)', async () => {
      const folderId = 10;
      const parentId = 5;

      const getFolderByIdSpy = vi.spyOn(folderOps, 'getFolderById')
        .mockResolvedValueOnce({ id: folderId, name: 'Child', parentId: parentId, isExpanded: true })
        .mockResolvedValueOnce({ id: parentId, name: 'Parent', parentId: 0, isExpanded: true });

      mockDb.update = vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined)
        })
      });

      await folderOps.expandAncestorFolders(folderId);

      // Should complete without errors even if already expanded
      expect(getFolderByIdSpy).toHaveBeenCalled();
      getFolderByIdSpy.mockRestore();
    });
  });

  describe('Edge Cases', () => {
    describe('Move to Non-Existent Parent', () => {
      it('should handle moving folder to non-existent parent folder', async () => {
        const folderId = 5;
        const nonExistentParentId = 999;

        const getFolderByIdSpy = vi.spyOn(folderOps, 'getFolderById')
          .mockResolvedValueOnce({ id: folderId, name: 'Folder', parentId: 0, isExpanded: false })
          .mockResolvedValueOnce(null);

        await expect(
          folderOps.moveFolder(folderId, nonExistentParentId, mockParseFolderIds, mockUpdateFileFolderIds, mockGetAllFiles)
        ).rejects.toThrow();

        getFolderByIdSpy.mockRestore();
      });
    });

    describe('Remove Folder with Files in Multiple Locations', () => {
      it('should preserve files that exist in other folders when removing folder', async () => {
        const folderId = 5;
        const parentId = 0;

        const folder = {
          id: folderId,
          name: 'FolderToRemove',
          parentId: parentId,
          isExpanded: false,
        };

        const sharedFile = {
          id: 101,
          filename: 'shared.txt',
          path: '/shared.txt',
          folderIds: JSON.stringify([folderId, 10, 20]),
          filetype: 'text',
          fileStorageType: 'import',
        };

        const getFolderByIdSpy = vi.spyOn(folderOps, 'getFolderById').mockResolvedValue(folder);
        const getChildFoldersSpy = vi.spyOn(folderOps as any, 'getChildFolders').mockResolvedValue([]);
        const getAllDescendantIdsSpy = vi.spyOn(folderOps, 'getAllDescendantIds').mockResolvedValue([folderId]);

        mockGetAllFiles.mockResolvedValue([sharedFile]);

        mockDb.delete = vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined)
        });

        await folderOps.removeFolder(folderId, mockParseFolderIds, mockUpdateFileFolderIds, mockGetAllFiles);

        // File should be updated to remove folderId, not deleted
        expect(mockUpdateFileFolderIds).toHaveBeenCalledWith(101, [10, 20]);
        expect(mockDb.delete).toHaveBeenCalled();

        getFolderByIdSpy.mockRestore();
        getChildFoldersSpy.mockRestore();
        getAllDescendantIdsSpy.mockRestore();
      });
    });

    describe('Remove Child of Root Folder', () => {
      it('should remove direct child of root folder and move its children to root', async () => {
        const folderId = 5;
        const parentId = 0;
        const childId = 10;

        const folder = {
          id: folderId,
          name: 'DirectChildOfRoot',
          parentId: parentId,
          isExpanded: false,
        };

        const child = {
          id: childId,
          name: 'GrandchildOfRoot',
          parentId: folderId,
          isExpanded: false,
        };

        const getFolderByIdSpy = vi.spyOn(folderOps, 'getFolderById').mockResolvedValue(folder);
        const getChildFoldersSpy = vi.spyOn(folderOps as any, 'getChildFolders').mockResolvedValue([child]);
        const getFolderByNameAndParentSpy = vi.spyOn(folderOps as any, 'getFolderByNameAndParent').mockResolvedValue(undefined);
        const getAllDescendantIdsSpy = vi.spyOn(folderOps, 'getAllDescendantIds').mockResolvedValue([folderId]);

        mockDb.update = vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(undefined)
          })
        });

        mockDb.delete = vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined)
        });

        mockGetAllFiles.mockResolvedValue([]);

        await folderOps.removeFolder(folderId, mockParseFolderIds, mockUpdateFileFolderIds, mockGetAllFiles);

        expect(mockDb.update).toHaveBeenCalled();
        expect(mockDb.delete).toHaveBeenCalled();

        getFolderByIdSpy.mockRestore();
        getChildFoldersSpy.mockRestore();
        getFolderByNameAndParentSpy.mockRestore();
        getAllDescendantIdsSpy.mockRestore();
      });
    });
  });

  describe('Get All Descendant IDs', () => {
    it('should return all descendant IDs for a folder with nested children', async () => {
      const folderId = 1;
      const childId = 2;
      const grandchildId = 3;

      mockDb.select = vi.fn()
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([{ id: childId, name: 'Child', parentId: folderId, isExpanded: false }])
          })
        })
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([{ id: grandchildId, name: 'Grandchild', parentId: childId, isExpanded: false }])
          })
        })
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([])
          })
        });

      const result = await folderOps.getAllDescendantIds(folderId);

      expect(result).toEqual([folderId, childId, grandchildId]);
    });

    it('should return only the folder ID when folder has no children', async () => {
      const folderId = 1;

      mockDb.select = vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([])
        })
      });

      const result = await folderOps.getAllDescendantIds(folderId);

      expect(result).toEqual([folderId]);
    });

    it('should handle folder with single level children', async () => {
      const folderId = 1;
      const child1Id = 2;
      const child2Id = 3;

      mockDb.select = vi.fn()
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([
              { id: child1Id, name: 'Child1', parentId: folderId, isExpanded: false },
              { id: child2Id, name: 'Child2', parentId: folderId, isExpanded: false }
            ])
          })
        })
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([])
          })
        })
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([])
          })
        });

      const result = await folderOps.getAllDescendantIds(folderId);

      expect(result).toEqual([folderId, child1Id, child2Id]);
    });
  });
});
