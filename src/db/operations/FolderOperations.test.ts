import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FolderOperations } from './FolderOperations';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../schema';
import { ERROR_MESSAGES } from '../../config/constants';

/**
 * Test suite for FolderOperations - Data Structure Protection
 *
 * This test suite validates that the core business logic prevents invalid
 * operations at the data layer, independent of any UI or interface constraints.
 *
 * These tests ensure that even if the interface layer allowed such operations,
 * the data structure protection would prevent them from executing.
 *
 * Focus: Root folder (ID=0) cannot be moved or deleted under any circumstances.
 */
describe('FolderOperations - Data Structure Protection', () => {
  let folderOps: FolderOperations;
  let mockDb: BetterSQLite3Database<typeof schema>;

  // Mock helper functions used by move/remove operations
  const mockParseFolderIds = vi.fn((json: string | null) => {
    if (!json) return [];
    return JSON.parse(json);
  });

  const mockUpdateFileFolderIds = vi.fn(async () => {
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

  describe('Root Folder Cannot Be Moved', () => {
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

  describe('Root Folder Cannot Be Removed', () => {
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

  describe('Root Protection Is First-Class', () => {
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
  });

  describe('Error Messages Are Reliable', () => {
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
    });
  });
});
