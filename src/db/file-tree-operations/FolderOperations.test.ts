import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../schema';
import { FolderOperations } from './FolderOperations';
import { FolderValidation } from './FolderValidation';
import { FolderQueries } from './FolderQueries';
import { FileQueries } from './FileQueries';
import { FolderMoveOperations } from './FolderMoveOperations';

describe('FolderOperations', () => {
  let mockDb: BetterSQLite3Database<typeof schema>;
  let folderOperations: FolderOperations;
  let folderQueries: FolderQueries;
  let validation: FolderValidation;

  beforeEach(() => {
    // Create mock methods that can be updated per test
    const mockWhere = vi.fn();
    const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
    const mockSelect = vi.fn().mockReturnValue({ from: mockFrom });

    // Create a mock database
    mockDb = {
      select: mockSelect,
      insert: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    } as unknown as BetterSQLite3Database<typeof schema>;

    // Initialize dependencies
    validation = new FolderValidation(mockDb);
    folderQueries = new FolderQueries(mockDb);
    const fileQueries = new FileQueries(mockDb);
    const folderMoveOperations = new FolderMoveOperations(mockDb, validation, folderQueries, fileQueries);
    folderOperations = new FolderOperations(mockDb, validation, folderQueries, fileQueries, folderMoveOperations);
  });

  describe('createFolder', () => {
    it('should prevent creating a folder with a duplicate name at the same level (case-sensitive)', async () => {
      // Mock existing folder with name "Documents" at root level (parentId: 0)

      // Spy on validation method and make it throw for exact match
      vi.spyOn(validation, 'validateNoDuplicateFolderName').mockImplementation(async (name: string) => {
        if (name === 'Documents') {
          throw new Error('A folder with this name already exists at this level');
        }
      });

      // Mock insert for successful case
      const newFolder: schema.Folder = {
        id: 2,
        name: 'documents',
        parentId: 0,
        isExpanded: false,
        createdAt: new Date(),
      };
      const mockReturning = vi.fn().mockResolvedValue([newFolder]);
      const mockValues = vi.fn().mockReturnValue({ returning: mockReturning });
      mockDb.insert = vi.fn().mockReturnValue({ values: mockValues });

      // Try to create another folder with the exact same name - should fail
      await expect(
        folderOperations.createFolder('Documents', 0)
      ).rejects.toThrow('A folder with this name already exists at this level');

      // Try with different casing - should succeed (case-sensitive)
      const result = await folderOperations.createFolder('documents', 0);
      expect(result.name).toBe('documents');
    });
  });

  describe('removeFolder', () => {
    it('should prevent removing the root folder', async () => {
      // Try to remove the system root folder (id: 0)
      await expect(
        folderOperations.removeFolder(0)
      ).rejects.toThrow('Cannot remove the system root folder');
    });
  });

  describe('moveFolder', () => {
    it('should prevent moving a folder into one of its descendants', async () => {
      // Create a folder hierarchy:
      // Root (0)
      //   └── Folder A (id: 1)
      //       └── Folder B (id: 2)
      //           └── Folder C (id: 3)

      const folderA: schema.Folder = {
        id: 1,
        name: 'Folder A',
        parentId: 0,
        isExpanded: false,
        createdAt: new Date(),
      };

      const folderB: schema.Folder = {
        id: 2,
        name: 'Folder B',
        parentId: 1,
        isExpanded: false,
        createdAt: new Date(),
      };

      const folderC: schema.Folder = {
        id: 3,
        name: 'Folder C',
        parentId: 2,
        isExpanded: false,
        createdAt: new Date(),
      };

      // Mock getFolderById to return the appropriate folder
      vi.spyOn(folderQueries, 'getFolderById').mockImplementation(async (id: number) => {
        if (id === 1) return folderA;
        if (id === 2) return folderB;
        if (id === 3) return folderC;
        return undefined;
      });

      // Try to move Folder A (id: 1) into Folder C (id: 3, its descendant)
      await expect(
        folderOperations.moveFolder(folderA.id, folderC.id)
      ).rejects.toThrow('Cannot move folder to its own descendant');

      // Try to move Folder A (id: 1) into Folder B (id: 2, its direct child)
      await expect(
        folderOperations.moveFolder(folderA.id, folderB.id)
      ).rejects.toThrow('Cannot move folder to its own descendant');
    });

    it('should throw DUPLICATE_FOLDER_NAME error when moving to a location with same-named folder (without forceMerge)', async () => {
      // Create a folder hierarchy:
      // Root (0)
      //   ├── Folder A (id: 1)
      //   │   └── Documents (id: 2)
      //   └── Folder B (id: 3)
      //       └── Documents (id: 4)

      const folderA: schema.Folder = {
        id: 1,
        name: 'Folder A',
        parentId: 0,
        isExpanded: false,
        createdAt: new Date(),
      };

      const documentsInA: schema.Folder = {
        id: 2,
        name: 'Documents',
        parentId: 1,
        isExpanded: false,
        createdAt: new Date(),
      };

      const folderB: schema.Folder = {
        id: 3,
        name: 'Folder B',
        parentId: 0,
        isExpanded: false,
        createdAt: new Date(),
      };

      const documentsInB: schema.Folder = {
        id: 4,
        name: 'Documents',
        parentId: 3,
        isExpanded: false,
        createdAt: new Date(),
      };

      // Mock getFolderById
      vi.spyOn(folderQueries, 'getFolderById').mockImplementation(async (id: number) => {
        if (id === 1) return folderA;
        if (id === 2) return documentsInA;
        if (id === 3) return folderB;
        if (id === 4) return documentsInB;
        return undefined;
      });

      // Mock getFolderByNameAndParent to return existing folder
      vi.spyOn(folderQueries, 'getFolderByNameAndParent').mockImplementation(
        async (name: string, parentId: number, excludeFolderId?: number) => {
          if (name === 'Documents' && parentId === 3 && excludeFolderId === 2) {
            return documentsInB; // Return the existing folder with same name
          }
          return undefined;
        }
      );

      // Try to move Documents (id: 2) from Folder A to Folder B without forceMerge
      // This should throw DUPLICATE_FOLDER_NAME error
      await expect(
        folderOperations.moveFolder(documentsInA.id, folderB.id, false)
      ).rejects.toThrow('DUPLICATE_FOLDER_NAME');
    });
  });
});
