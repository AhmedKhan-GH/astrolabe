import { useState, useEffect, useCallback } from 'react'
import FileTreeView, { type TreeNode } from '../FileTree/FileTreeView'
import ContextMenu from '../FileTree/ContextMenu'
import RootDirectoryContextMenu from './RootDirectoryContextMenu'
import { buildFileTree } from '../FileTree/buildFileTree'
import DirectoryHeader from './DirectoryHeader'
import FolderInputForm from './FolderInputForm'
import FileFilter from './FileFilter'
import type { Folder, File } from '../../db/schema'
import { logger } from '../../utils/logger'
import { UI_LABELS } from '../../config/constants'

interface ContextMenuState {
  node: TreeNode
  x: number
  y: number
  folderId: number
}

interface RootContextMenuState {
  x: number
  y: number
}

interface DirectoryTreeProps {
  selectedFilter: string
  onFilterChange: (filter: string) => void
  onTreeDataChange?: (treeData: TreeNode[]) => void
}

function DirectoryTree({ selectedFilter, onFilterChange, onTreeDataChange }: DirectoryTreeProps) {
  const [treeData, setTreeData] = useState<TreeNode[]>([])
  const [showFolderInput, setShowFolderInput] = useState(false)
  const [folderName, setFolderName] = useState('')
  const [folderParentId, setFolderParentId] = useState<number | null>(null)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [rootContextMenu, setRootContextMenu] = useState<RootContextMenuState | null>(null)
  const [allFolders, setAllFolders] = useState<Folder[]>([])
  const [allFiles, setAllFiles] = useState<(File & { folderIds: string })[]>([])
  const [currentDatabase, setCurrentDatabase] = useState<string | null>(null)
  const [defaultDatabase, setDefaultDatabase] = useState<string | null>(null)

  const loadTreeData = useCallback(async () => {
    try {
      const [folders, files] = await Promise.all([
        window.electron.getAllFolders(),
        window.electron.getAllFiles()
      ])

      logger.debug({ folderCount: folders.length, fileCount: files.length }, '[DirectoryTree] Data loaded successfully');

      setAllFolders(folders)
      setAllFiles(files)
      const tree = buildFileTree(folders, files)
      setTreeData(tree)
      onTreeDataChange?.(tree)
    } catch (error) {
      logger.error({ error }, '[DirectoryTree] Failed to load tree data')
    }
  }, [onTreeDataChange])

  useEffect(() => {
    let isMounted = true

    const fetchData = async () => {
      try {
        const [folders, files, current, defaultPath] = await Promise.all([
          window.electron.getAllFolders(),
          window.electron.getAllFiles(),
          window.electron.getCurrentDatabase(),
          window.electron.getDefaultDatabasePath()
        ])

        if (isMounted) {
          setAllFolders(folders)
          setAllFiles(files)
          const tree = buildFileTree(folders, files)
          setTreeData(tree)
          setCurrentDatabase(current)
          setDefaultDatabase(defaultPath)
          onTreeDataChange?.(tree)
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

  const handleExpandAll = async (folderId: number) => {
    logger.info({ folderId }, '[DirectoryTree] Expanding all descendants')
    await window.electron.expandAllDescendants(folderId)
    await loadTreeData()
    setContextMenu(null)
  }

  const handleCollapseAll = async (folderId: number) => {
    logger.info({ folderId }, '[DirectoryTree] Collapsing all descendants')
    await window.electron.collapseAllDescendants(folderId)
    await loadTreeData()
    setContextMenu(null)
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
      await window.electron.addFile(numericFileId, targetFolderId)

      logger.info('[DirectoryTree] Add file successful, reloading tree')
      await loadTreeData()
      setContextMenu(null)
    } catch (error) {
      logger.error({ error }, '[DirectoryTree] Failed to add to folder')
      alert('Failed to add to folder: ' + error)
    }
  }

  const handleAddContentsTo = async (targetParentId: number) => {
    if (!contextMenu || contextMenu.node.type !== 'folder') return

    logger.info({ nodeId: contextMenu.node.id, targetParentId }, '[DirectoryTree] handleAddContentsTo called')

    try {
      const sourceFolderId = parseInt(contextMenu.node.id.replace('folder-', ''))
      logger.info({ sourceFolderId, targetParentId }, '[DirectoryTree] Adding folder to target parent')
      await window.electron.addFolder(sourceFolderId, targetParentId)

      logger.info('[DirectoryTree] Add folder successful, reloading tree')
      await loadTreeData()
      setContextMenu(null)
    } catch (error) {
      logger.error({ error }, '[DirectoryTree] Failed to add folder')
      alert('Failed to add folder: ' + error)
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
      : `Are you sure you want to remove the folder "${contextMenu.node.name}"? Child folders and files will be moved to the parent folder.`

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

  const handleRootMenuClick = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setRootContextMenu({ x: e.clientX, y: e.clientY })
  }

  const handleRootMenuClose = () => {
    setRootContextMenu(null)
  }

  const handleRootImportFile = () => {
    setRootContextMenu(null)
    void handleImportFile()
  }

  const handleRootReferenceFile = () => {
    setRootContextMenu(null)
    void handleReferenceFile()
  }

  const handleRootCreateFolder = () => {
    setRootContextMenu(null)
    handleCreateFolder()
  }

  const handleRootClearAll = () => {
    setRootContextMenu(null)
    void handleClearAll()
  }

  const handleRootExpandAll = async () => {
    setRootContextMenu(null)
    logger.info('[DirectoryTree] Expanding all folders in tree')
    await window.electron.expandAllFolders()
    await loadTreeData()
  }

  const handleRootCollapseAll = async () => {
    setRootContextMenu(null)
    logger.info('[DirectoryTree] Collapsing all folders in tree')
    await window.electron.collapseAllFolders()
    await loadTreeData()
  }

  const getDatabaseName = (dbPath: string | null) => {
    // If no dbPath but we have a defaultDatabase, we're using Database
    if (!dbPath && defaultDatabase) return UI_LABELS.DATABASE
    if (!dbPath) return UI_LABELS.DATABASE
    // Extract filename from path (works cross-platform)
    let name = dbPath.split(/[\\/]/).pop() || UI_LABELS.DATABASE
    // If it's the database, show "Database"
    if (name === 'data' || dbPath === defaultDatabase) return UI_LABELS.DATABASE
    // Remove .astro extension if present
    if (name.endsWith('.astro')) {
      name = name.slice(0, -6)
    }
    return name
  }

  return (
    <>
      <FileFilter files={allFiles} selectedFilter={selectedFilter} onFilterChange={onFilterChange} />

      <DirectoryHeader
        databaseName={getDatabaseName(currentDatabase)}
        onMenuClick={handleRootMenuClick}
        onUploadFile={handleImportFile}
        onReferenceFile={handleReferenceFile}
        onCreateFolder={handleCreateFolder}
      />

      {showFolderInput && (
        <FolderInputForm
          folderName={folderName}
          onFolderNameChange={setFolderName}
          onSubmit={submitFolder}
          onCancel={cancelFolder}
          isDuplicate={checkIsDuplicateFolderName(folderName)}
        />
      )}

      <FileTreeView data={treeData} onNodeClick={handleNodeClick} onNodeDoubleClick={handleNodeDoubleClick} onNodeContextMenu={handleNodeContextMenu} onToggleExpand={handleToggleExpand} onAddFolder={handleAddFolderToParent} onAddFile={handleAddFileToFolder} onReferenceFile={handleReferenceFileToFolder} onExpandAll={handleExpandAll} onCollapseAll={handleCollapseAll} onMoveTo={handleMoveTo} allFolders={allFolders} allFiles={allFiles} />

      {contextMenu && (
        <ContextMenu
          node={contextMenu.node}
          x={contextMenu.x}
          y={contextMenu.y}
          allFolders={allFolders}
          allFiles={allFiles}
          currentFolderId={contextMenu.folderId}
          databaseName={getDatabaseName(currentDatabase)}
          onMoveTo={handleMoveTo}
          onAddTo={contextMenu.node.type === 'file' ? handleAddTo : undefined}
          onAddContentsTo={contextMenu.node.type === 'folder' ? handleAddContentsTo : undefined}
          onAddFolder={contextMenu.node.type === 'folder' ? handleAddFolderToParent : undefined}
          onAddFile={contextMenu.node.type === 'folder' ? handleAddFileToFolder : undefined}
          onReferenceFile={contextMenu.node.type === 'folder' ? handleReferenceFileToFolder : undefined}
          onRemove={contextMenu.node.type === 'file' ? handleRemoveFromFolder : undefined}
          onDelete={handleDeleteNode}
          onDeleteFolder={contextMenu.node.type === 'folder' ? handleDeleteFolder : undefined}
          onExpandAll={contextMenu.node.type === 'folder' ? handleExpandAll : undefined}
          onCollapseAll={contextMenu.node.type === 'folder' ? handleCollapseAll : undefined}
          onClose={() => setContextMenu(null)}
        />
      )}

      {rootContextMenu && (
        <RootDirectoryContextMenu
          x={rootContextMenu.x}
          y={rootContextMenu.y}
          onImportFile={handleRootImportFile}
          onReferenceFile={handleRootReferenceFile}
          onCreateFolder={handleRootCreateFolder}
          onExpandAll={handleRootExpandAll}
          onCollapseAll={handleRootCollapseAll}
          onClearAll={handleRootClearAll}
          onClose={handleRootMenuClose}
        />
      )}

    </>
  )
}

export default DirectoryTree
