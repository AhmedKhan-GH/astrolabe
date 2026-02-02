import { type TreeNode } from './FileTreeView'
import type { Folder, File } from '../../db/schema'

export function buildFileTree(folders: Folder[], files: File[]): TreeNode[] {
  // Build folder hierarchy
  const folderMap: Record<number, TreeNode> = {}
  const rootFolders: TreeNode[] = []

  // Create folder nodes
  folders.forEach((folder) => {
    folderMap[folder.id] = {
      id: `folder-${folder.id}`,
      name: folder.name,
      type: 'folder',
      children: []
    }
  })

  // Build hierarchy
  folders.forEach((folder) => {
    const node = folderMap[folder.id]
    if (folder.parentId && folderMap[folder.parentId]) {
      folderMap[folder.parentId].children!.push(node)
    } else {
      rootFolders.push(node)
    }
  })

  // Add files to their folders (or root if folderId = 0)
  files.forEach((file) => {
    const fileNode: TreeNode = {
      id: `file-${file.id}`,
      name: file.filename,
      type: 'file'
    }

    if (file.folderIds) {
      const folderIds = JSON.parse(file.folderIds)
      folderIds.forEach((folderId: number) => {
        if (folderId === 0) {
          // folderId = 0 means root
          rootFolders.push(fileNode)
        } else if (folderMap[folderId]) {
          folderMap[folderId].children!.push(fileNode)
        }
      })
    } else {
      // Legacy: no folderIds means root
      rootFolders.push(fileNode)
    }
  })

  return rootFolders
}
