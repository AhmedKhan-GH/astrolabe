import { useState, useEffect, useCallback } from 'react'
import FileTreeView, { type TreeNode } from '../FileTree/FileTreeView'
import ContextMenu from '../FileTree/ContextMenu'
import { buildFileTree } from '../FileTree/buildFileTree'
import DirectoryHeader from './DirectoryHeader'
import FolderInputForm from './FolderInputForm'
import Menu from './Menu'
import type { Folder, File } from '../../db/schema'
import { logger } from '../../utils/logger'

interface ContextMenuState {
  node: TreeNode
  x: number
  y: number
  folderId: number
}

function DirectoryTree() {
  const [treeData, setTreeData] = useState<TreeNode[]>([])
  const [showFolderInput, setShowFolderInput] = useState(false)
  const [folderName, setFolderName] = useState('')
  const [folderParentId, setFolderParentId] = useState<number | null>(null)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [allFolders, setAllFolders] = useState<Folder[]>([])
  const [allFiles, setAllFiles] = useState<File[]>([])

  const loadTreeData = useCallback(async () => {
    try {
      const [folders, files] = await Promise.all([
        window.electron.getAllFolders(),
        window.electron.getAllFiles()
      ])

      logger.debug({ folderCount: folders.length, fileCount: files.length }, '[DirectoryTree] Data loaded successfully');

      setAllFolders(folders)
      setAllFiles(files)
      setTreeData(buildFileTree(folders, files))
    } catch (error) {
      logger.error({ error }, '[DirectoryTree] Failed to load tree data')
    }
  }, [])

  useEffect(() => {
    let isMounted = true

    const fetchData = async () => {
      try {
        const [folders, files] = await Promise.all([
          window.electron.getAllFolders(),
          window.electron.getAllFiles()
        ])

        if (isMounted) {
          setAllFolders(folders)
          setAllFiles(files)
          setTreeData(buildFileTree(folders, files))
        }
      } catch (error) {
        logger.error({ error }, '[DirectoryTree] Failed to load tree data in useEffect')
      }
    }

    void fetchData()

    return () => {
      isMounted = false
    }
  }, [])

  const handleNodeClick = async (node: TreeNode) => {
    logger.debug({ node }, '[DirectoryTree] Node clicked')
  }

  const handleNodeDoubleClick = async (node: TreeNode) => {
    logger.debug({ node }, '[DirectoryTree] Node double-clicked')

    if (node.type === 'file' && node.storageType === 'reference') {
      const fileId = parseInt(node.id.replace('file-', ''))
      const file = allFiles.find(f => f.id === fileId)

      if (file?.path) {
        try {
          logger.info({ filePath: file.path }, '[DirectoryTree] Opening file in default app')
          await window.electron.openFileInDefaultApp(file.path)
        } catch (error) {
          logger.error({ error, filePath: file.path }, '[DirectoryTree] Failed to open file')
        }
      }
    }
  }

  const handleNodeContextMenu = (node: TreeNode, folderId: number, e: React.MouseEvent) => {
    e.preventDefault()
    setContextMenu({ node, x: e.clientX, y: e.clientY, folderId })
  }

  const handleToggleExpand = async (nodeId: string) => {
    const folderId = parseInt(nodeId.replace('folder-', ''))
    await window.electron.toggleFolderExpanded(folderId)
    await loadTreeData()
  }

  const handleMoveTo = async (targetFolderId: number) => {
    if (!contextMenu) return

    logger.info({ nodeType: contextMenu.node.type, nodeId: contextMenu.node.id, targetFolderId }, '[DirectoryTree] handleMoveTo called')

    try {
      if (contextMenu.node.type === 'file') {
        const numericFileId = parseInt(contextMenu.node.id.replace('file-', ''))
        logger.info({ fileId: numericFileId, targetFolderId }, '[DirectoryTree] Moving file to folder')
        await window.electron.moveFile(numericFileId, targetFolderId)
        logger.info('[DirectoryTree] File move successful, reloading tree')
        await loadTreeData()
        setContextMenu(null)
      } else {
        const numericFolderId = parseInt(contextMenu.node.id.replace('folder-', ''))
        logger.info({ folderId: numericFolderId, targetFolderId }, '[DirectoryTree] Moving folder to parent')
        await window.electron.moveFolder(numericFolderId, targetFolderId)
        logger.info('[DirectoryTree] Folder move successful, reloading tree')
        await loadTreeData()
        setContextMenu(null)
      }
    } catch (error) {
      logger.error({ error }, '[DirectoryTree] Failed to move')
      alert('Failed to move: ' + error)
    }
  }

  const handleAddTo = async (targetFolderId: number) => {
    if (!contextMenu || contextMenu.node.type !== 'file') return

    logger.info({ nodeId: contextMenu.node.id, targetFolderId }, '[DirectoryTree] handleAddTo called')

    try {
      const numericFileId = parseInt(contextMenu.node.id.replace('file-', ''))
      logger.info({ fileId: numericFileId, targetFolderId }, '[DirectoryTree] Adding file to folder')
      await window.electron.includeFileInFolder(numericFileId, targetFolderId)

      logger.info('[DirectoryTree] Add successful, reloading tree')
      await loadTreeData()
      setContextMenu(null)
    } catch (error) {
      logger.error({ error }, '[DirectoryTree] Failed to add to folder')
      alert('Failed to add to folder: ' + error)
    }
  }

  const handleRemoveFromFolder = async () => {
    if (!contextMenu || contextMenu.node.type !== 'file') return

    const fileId = parseInt(contextMenu.node.id.replace('file-', ''))
    const folderId = contextMenu.folderId

    try {
      logger.info({ fileId, folderId }, '[DirectoryTree] Removing file from folder')
      await window.electron.removeFileFromFolder(fileId, folderId)
      await loadTreeData()
      setContextMenu(null)
    } catch (error) {
      logger.error({ error, fileId, folderId }, '[DirectoryTree] Failed to remove file from folder')
      alert('Failed to remove file from folder: ' + error)
    }
  }

  const handleDeleteNode = async () => {
    if (!contextMenu) return

    const confirmMessage = contextMenu.node.type === 'file'
      ? `Are you sure you want to delete "${contextMenu.node.name}"?`
      : `Are you sure you want to remove the folder "${contextMenu.node.name}"? This will not delete the files inside.`

    if (window.confirm(confirmMessage)) {
      try {
        const id = parseInt(contextMenu.node.id.replace(/^(file|folder)-/, ''))
        logger.info({ id, type: contextMenu.node.type, name: contextMenu.node.name }, '[DirectoryTree] Deleting node')
        if (contextMenu.node.type === 'file') {
          await window.electron.deleteFile(id)
        } else {
          await window.electron.removeFolder(id)
        }
        logger.info('[DirectoryTree] Delete successful, reloading tree')
        await loadTreeData()
        setContextMenu(null)
      } catch (error) {
        logger.error({ error }, '[DirectoryTree] Failed to delete')
      }
    }
  }

  const handleDeleteFolder = async () => {
    if (!contextMenu || contextMenu.node.type !== 'folder') return

    const confirmMessage = `Are you sure you want to delete the folder "${contextMenu.node.name}"? This will cascade delete all subfolders and remove files (deleting unique files).`

    if (window.confirm(confirmMessage)) {
      try {
        const id = parseInt(contextMenu.node.id.replace('folder-', ''))
        logger.info({ folderId: id, folderName: contextMenu.node.name }, '[DirectoryTree] Cascade deleting folder')
        await window.electron.deleteFolder(id)
        logger.info('[DirectoryTree] Folder delete successful, reloading tree')
        await loadTreeData()
        setContextMenu(null)
      } catch (error) {
        logger.error({ error }, '[DirectoryTree] Failed to delete folder')
      }
    }
  }

  const handleImportFile = async () => {
    try {
      logger.info('[DirectoryTree] Importing files to root')
      await window.electron.selectAndImportFiles()
      await loadTreeData()
    } catch (error) {
      logger.error({ error }, '[DirectoryTree] Failed to import files')
    }
  }

  const handleReferenceFile = async () => {
    try {
      logger.info('[DirectoryTree] Referencing files to root')
      await window.electron.selectAndReferenceFiles()
      await loadTreeData()
    } catch (error) {
      logger.error({ error }, '[DirectoryTree] Failed to reference files')
    }
  }

  const handleCreateFolder = () => {
    setFolderParentId(null)
    setShowFolderInput(true)
  }

  const handleClearAll = async () => {
    const confirmMessage = 'Are you sure you want to delete ALL folders and files? This will cascade delete everything in your directory. This action cannot be undone.'

    if (window.confirm(confirmMessage)) {
      try {
        logger.info('[DirectoryTree] Clearing all folders and files')

        // Get all direct children of root (folders with parentId = 0)
        const rootChildren = allFolders.filter(f => f.parentId === 0)

        // Delete each root child folder (cascade deletes all descendants)
        for (const folder of rootChildren) {
          logger.info({ folderId: folder.id, folderName: folder.name }, '[DirectoryTree] Deleting root child folder')
          await window.electron.deleteFolder(folder.id)
        }

        // After cascade deleting all folders, get fresh file list to see what remains
        const remainingFiles = await window.electron.getAllFiles()

        // Delete ALL remaining files (they should all be root-only at this point)
        // The cascade delete operation already handled removing files from deleted folders
        for (const file of remainingFiles) {
          logger.info({ fileId: file.id, filename: file.filename }, '[DirectoryTree] Deleting remaining file')
          await window.electron.deleteFile(file.id)
        }

        logger.info('[DirectoryTree] Clear all successful, reloading tree')
        await loadTreeData()
      } catch (error) {
        logger.error({ error }, '[DirectoryTree] Failed to clear all')
        alert('Failed to clear all: ' + error)
      }
    }
  }

  const handleAddFolderToParent = (parentFolderId: number) => {
    setFolderParentId(parentFolderId)
    setShowFolderInput(true)
    setContextMenu(null)
  }

  const handleAddFileToFolder = async (folderId: number) => {
    logger.info({ folderId }, '[DirectoryTree] handleAddFileToFolder called')
    setContextMenu(null)
    try {
      logger.info({ folderId }, '[DirectoryTree] Calling selectAndImportFilesToFolder')
      const result = await window.electron.selectAndImportFilesToFolder(folderId)
      logger.info({ result, folderId }, '[DirectoryTree] Import to folder result')

      await loadTreeData()
    } catch (error) {
      logger.error({ error, folderId }, '[DirectoryTree] Failed to import files to folder')
    }
  }

  const handleReferenceFileToFolder = async (folderId: number) => {
    logger.info({ folderId }, '[DirectoryTree] handleReferenceFileToFolder called')
    setContextMenu(null)
    try {
      logger.info({ folderId }, '[DirectoryTree] Calling selectAndReferenceFilesToFolder')
      const result = await window.electron.selectAndReferenceFilesToFolder(folderId)
      logger.info({ result, folderId }, '[DirectoryTree] Reference to folder result')

      await loadTreeData()
    } catch (error) {
      logger.error({ error, folderId }, '[DirectoryTree] Failed to reference files to folder')
    }
  }

  const checkIsDuplicateFolderName = (name: string): boolean => {
    const trimmedName = name.trim()
    if (!trimmedName) return false

    const parentIdForCheck = folderParentId ?? 0
    const existingFolders = allFolders.filter(f => (f.parentId ?? 0) === parentIdForCheck)
    return existingFolders.some(f => f.name === trimmedName)
  }

  const submitFolder = async () => {
    if (!folderName.trim()) {
      alert('Folder name cannot be empty')
      setFolderName('')
      setShowFolderInput(false)
      setFolderParentId(null)
      return
    }

    try {
      const parentIdForApi = folderParentId ?? 0
      logger.info({ folderName: folderName.trim(), parentId: parentIdForApi }, '[DirectoryTree] Creating new folder')
      await window.electron.createFolder(folderName.trim(), parentIdForApi)

      logger.info('[DirectoryTree] Folder created successfully, reloading tree')
      await loadTreeData()
      setFolderName('')
      setFolderParentId(null)
      setShowFolderInput(false)
    } catch (error) {
      logger.error({ error, folderName: folderName.trim() }, '[DirectoryTree] Failed to create folder')
      alert(error instanceof Error ? error.message : 'Failed to create folder')
      // Don't reset state or reload data on error - let user correct their input
      return
    }
  }

  const cancelFolder = () => {
    setFolderName('')
    setFolderParentId(null)
    setShowFolderInput(false)
  }


  return (
    <>
      <Menu files={allFiles} />

      <DirectoryHeader onUploadFile={handleImportFile} onReferenceFile={handleReferenceFile} onCreateFolder={handleCreateFolder} onClearAll={handleClearAll} />

      {showFolderInput && (
        <FolderInputForm
          folderName={folderName}
          onFolderNameChange={setFolderName}
          onSubmit={submitFolder}
          onCancel={cancelFolder}
          isDuplicate={checkIsDuplicateFolderName(folderName)}
        />
      )}

      <FileTreeView data={treeData} onNodeClick={handleNodeClick} onNodeDoubleClick={handleNodeDoubleClick} onNodeContextMenu={handleNodeContextMenu} onToggleExpand={handleToggleExpand} />

      {contextMenu && (
        <ContextMenu
          node={contextMenu.node}
          x={contextMenu.x}
          y={contextMenu.y}
          allFolders={allFolders}
          allFiles={allFiles}
          currentFolderId={contextMenu.folderId}
          onMoveTo={handleMoveTo}
          onAddTo={contextMenu.node.type === 'file' ? handleAddTo : undefined}
          onAddFolder={contextMenu.node.type === 'folder' ? handleAddFolderToParent : undefined}
          onAddFile={contextMenu.node.type === 'folder' ? handleAddFileToFolder : undefined}
          onReferenceFile={contextMenu.node.type === 'folder' ? handleReferenceFileToFolder : undefined}
          onRemove={contextMenu.node.type === 'file' ? handleRemoveFromFolder : undefined}
          onDelete={handleDeleteNode}
          onDeleteFolder={contextMenu.node.type === 'folder' ? handleDeleteFolder : undefined}
          onClose={() => setContextMenu(null)}
        />
      )}

    </>
  )
}

export default DirectoryTree
