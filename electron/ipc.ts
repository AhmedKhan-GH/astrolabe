import { ipcMain, app, dialog } from 'electron';
import { getDatabase } from './database';
import * as schema from '../src/db/schema';
import { eq, isNull } from 'drizzle-orm';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getDataDirectory, promptForDataDirectory, resetDataDirectory } from './settings';

export function setupIpcHandlers() {
  ipcMain.handle('selectAndUploadFiles', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'PDF Files', extensions: ['pdf'] }
      ]
    });

    if (result.canceled || result.filePaths.length === 0) {
      return [];
    }

    return uploadFiles(result.filePaths);
  });

  async function uploadFiles(filePaths: string[]) {
    const db = getDatabase();

    // Create files directory adjacent to database
    const dataDir = getDataDirectory();
    const filesDir = path.join(dataDir, 'files');

    if (!fs.existsSync(filesDir)) {
      fs.mkdirSync(filesDir, { recursive: true });
    }

    const uploadedFiles = [];

    for (const filePath of filePaths) {
      const stats = fs.statSync(filePath);
      const filename = path.basename(filePath);

      // Generate unique filename to avoid collisions
      const hash = crypto.randomBytes(8).toString('hex');
      const ext = path.extname(filename);
      const storedFilename = `${hash}${ext}`;
      const storedPath = path.join(filesDir, storedFilename);

      // Copy file to storage
      fs.copyFileSync(filePath, storedPath);

      // Insert metadata into database
      const inserted = await db.insert(schema.files).values({
        filename,
        path: storedPath,
        filetype: ext ? ext.slice(1) : null, // Remove leading dot from extension
      }).returning();

      uploadedFiles.push(inserted[0]);
    }

    return uploadedFiles;
  }

  ipcMain.handle('getAllFiles', async () => {
    const db = getDatabase();
    return db.select().from(schema.files);
  });

  ipcMain.handle('getAllFolders', async () => {
    const db = getDatabase();
    return db.select().from(schema.folders);
  });

  ipcMain.handle('createFolder', async (_, name: string, parentId?: number) => {
    console.log('createFolder called with name:', name, 'parentId:', parentId);
    const db = getDatabase();

    // Prevent "Root" as folder name (case-insensitive)
    const trimmedName = name.trim();
    console.log('Checking if name is Root:', trimmedName.toLowerCase());
    if (trimmedName.toLowerCase() === 'root') {
      console.log('Rejecting folder named Root');
      throw new Error('Cannot create folder named "Root"');
    }

    // Check for duplicate folder name at the same level
    const parent = parentId || null;
    const existing = parent === null
      ? await db.select().from(schema.folders).where(isNull(schema.folders.parentId))
      : await db.select().from(schema.folders).where(eq(schema.folders.parentId, parent));

    const duplicate = existing.find(f => f.name.toLowerCase() === trimmedName.toLowerCase());
    if (duplicate) {
      console.log('Found duplicate folder:', duplicate.name);
      throw new Error('A folder with this name already exists at this level');
    }

    const inserted = await db.insert(schema.folders).values({
      name: trimmedName,
      parentId: parent,
    }).returning();
    console.log('Folder created:', inserted[0]);
    return inserted[0];
  });

  ipcMain.handle('moveFile', async (_, fileId: number, folderId: number | null) => {
    console.log('moveFile called:', { fileId, folderId });
    const db = getDatabase();

    // Move replaces folderIds with just the target folder (or null for root)
    const newFolderIds = folderId !== null ? JSON.stringify([folderId]) : null;
    await db.update(schema.files)
      .set({ folderIds: newFolderIds })
      .where(eq(schema.files.id, fileId));
    console.log('File moved');
  });

  ipcMain.handle('includeFileInFolder', async (_, fileId: number, folderId: number) => {
    console.log('includeFileInFolder called:', { fileId, folderId });
    const db = getDatabase();

    // Get current file
    const file = await db.select().from(schema.files).where(eq(schema.files.id, fileId)).limit(1);
    console.log('File found:', file);
    if (file.length === 0) return;

    // Parse existing folderIds or create new array
    let folderIds: number[] = [];
    if (file[0].folderIds) {
      folderIds = JSON.parse(file[0].folderIds);
    }
    console.log('Current folderIds:', folderIds);

    // Add folderId if not already present
    if (!folderIds.includes(folderId)) {
      folderIds.push(folderId);
      console.log('Updating with new folderIds:', folderIds);
      await db.update(schema.files)
        .set({ folderIds: JSON.stringify(folderIds) })
        .where(eq(schema.files.id, fileId));
      console.log('Update complete');
    } else {
      console.log('File already in folder');
    }
  });

  ipcMain.handle('moveFolder', async (_, folderId: number, newParentId: number | null) => {
    console.log('moveFolder called:', { folderId, newParentId });
    const db = getDatabase();

    // Prevent moving folder to itself
    if (folderId === newParentId) {
      throw new Error('Cannot move folder to itself');
    }

    // Prevent moving folder to its own descendant (would create circular reference)
    if (newParentId !== null) {
      const isDescendant = async (parentId: number, targetId: number): Promise<boolean> => {
        const folder = await db.select().from(schema.folders).where(eq(schema.folders.id, parentId)).limit(1);
        if (folder.length === 0) return false;
        if (folder[0].parentId === targetId) return true;
        if (folder[0].parentId === null) return false;
        return isDescendant(folder[0].parentId, targetId);
      };

      if (await isDescendant(newParentId, folderId)) {
        throw new Error('Cannot move folder to its own descendant');
      }
    }

    await db.update(schema.folders)
      .set({ parentId: newParentId })
      .where(eq(schema.folders.id, folderId));
    console.log('Folder moved');
  });

  ipcMain.handle('deleteFile', async (_, fileId: number) => {
    console.log('deleteFile called:', fileId);
    const db = getDatabase();

    // Get file info first to delete physical file
    const file = await db.select().from(schema.files).where(eq(schema.files.id, fileId)).limit(1);
    if (file.length > 0 && file[0].path) {
      // Delete physical file
      if (fs.existsSync(file[0].path)) {
        fs.unlinkSync(file[0].path);
      }
    }

    // Delete from database
    await db.delete(schema.files).where(eq(schema.files.id, fileId));
    console.log('File deleted');
  });

  ipcMain.handle('deleteFolder', async (_, folderId: number) => {
    console.log('deleteFolder called:', folderId);
    const db = getDatabase();

    // Get the parent folder ID of the folder being deleted
    const folderToDelete = await db.select().from(schema.folders).where(eq(schema.folders.id, folderId)).limit(1);
    const parentFolderId = folderToDelete.length > 0 ? folderToDelete[0].parentId : null;
    console.log('Parent folder ID:', parentFolderId);

    // Get all descendant folder IDs to clean up file references
    const getAllDescendantIds = async (parentId: number): Promise<number[]> => {
      const children = await db.select().from(schema.folders).where(eq(schema.folders.parentId, parentId));
      let allIds: number[] = [parentId];

      for (const child of children) {
        const childIds = await getAllDescendantIds(child.id);
        allIds = allIds.concat(childIds);
      }

      return allIds;
    };

    const folderIdsToDelete = await getAllDescendantIds(folderId);
    console.log('Folders to clean from file references:', folderIdsToDelete);

    // Update files: remove deleted folder IDs and add parent folder ID if file loses all folders
    const files = await db.select().from(schema.files);
    for (const file of files) {
      if (file.folderIds) {
        const folderIds = JSON.parse(file.folderIds);
        const newFolderIds = folderIds.filter((id: number) => !folderIdsToDelete.includes(id));

        if (folderIds.length !== newFolderIds.length) {
          console.log(`File ${file.id} was in deleted folder(s)`);

          // If file loses all its folders, move it to the parent of the deleted folder
          if (newFolderIds.length === 0 && parentFolderId !== null) {
            console.log(`Moving file ${file.id} to parent folder ${parentFolderId}`);
            newFolderIds.push(parentFolderId);
          }

          await db.update(schema.files)
            .set({ folderIds: newFolderIds.length > 0 ? JSON.stringify(newFolderIds) : null })
            .where(eq(schema.files.id, file.id));
        }
      }
    }

    // Delete the parent folder (CASCADE will delete children automatically)
    console.log('Deleting folder and all children via CASCADE:', folderId);
    await db.delete(schema.folders).where(eq(schema.folders.id, folderId));
    console.log('Folder deleted successfully');
  });

  // Settings handlers
  ipcMain.handle('getDataDirectory', () => {
    return getDataDirectory();
  });

  ipcMain.handle('chooseDataDirectory', async () => {
    return await promptForDataDirectory();
  });

  ipcMain.handle('resetDataDirectory', () => {
    resetDataDirectory();
    return getDataDirectory();
  });

  console.log('IPC handlers ready');
}
