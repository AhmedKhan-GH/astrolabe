import { useState, useEffect, useCallback } from 'react'
import FileTreeView, { type TreeNode } from '../FileTree/FileTreeView'
import ContextMenu from '../FileTree/ContextMenu'
import FolderPickerModal from '../FileTree/FolderPickerModal'
import MergeFolderModal from '../FileTree/MergeFolderModal'
import { buildFileTree } from '../FileTree/buildFileTree'
import DirectoryHeader from './DirectoryHeader'
import FolderInputForm from './FolderInputForm'
import type { Folder, File } from '../../db/schema'

interface ContextMenuState {
  node: TreeNode
  x: number
  y: number
  folderId: number
}

interface MergeModalState {
  folderName: string
  sourceFolderId: number
  targetFolderId: number
}

function DirectoryTree() {
  const [treeData, setTreeData] = useState<TreeNode[]>([])
  const [showFolderInput, setShowFolderInput] = useState(false)
  const [folderName, setFolderName] = useState('')
  const [folderParentId, setFolderParentId] = useState<number | null>(null)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [mergeModal, setMergeModal] = useState<MergeModalState | null>(null)
  const [allFolders, setAllFolders] = useState<Folder[]>([])
  const [allFiles, setAllFiles] = useState<File[]>([])

  const loadTreeData = useCallback(async () => {
    try {
      // Health check to verify we're loading from the correct database
      const health = await window.electron.getDatabaseHealth();
      console.log('[DirectoryTree] Database health check:', health);
      console.log('[DirectoryTree] Loading data from:', health.databasePath);

      const [folders, files] = await Promise.all([
        window.electron.getAllFolders(),
        window.electron.getAllFiles()
      ])

      console.log('[DirectoryTree] Loaded folders:', folders.length, 'files:', files.length);

      setAllFolders(folders)
      setAllFiles(files)
      setTreeData(buildFileTree(folders, files))
    } catch (error) {
      console.error('Failed to load tree data:', error)
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
        console.error('Failed to load tree data:', error)
      }
    }

    void fetchData()

    return () => {
      isMounted = false
    }
  }, [])

  const handleNodeClick = async (node: TreeNode) => {
    console.log('Clicked node:', node)
  }

  const handleNodeDoubleClick = async (node: TreeNode) => {
    console.log('Double-clicked node:', node)

    if (node.type === 'file' && node.storageType === 'reference') {
      const fileId = parseInt(node.id.replace('file-', ''))
      const file = allFiles.find(f => f.id === fileId)

      if (file?.path) {
        try {
          await window.electron.openFileInDefaultApp(file.path)
        } catch (error) {
          console.error('Failed to open file:', error)
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

    console.log('handleMoveTo called:', { nodeType: contextMenu.node.type, nodeId: contextMenu.node.id, targetFolderId })

    try {
      if (contextMenu.node.type === 'file') {
        const numericFileId = parseInt(contextMenu.node.id.replace('file-', ''))
        console.log('Moving file:', numericFileId, 'to folder:', targetFolderId)
        await window.electron.moveFile(numericFileId, targetFolderId)
        console.log('Move successful, reloading tree')
        await loadTreeData()
        setContextMenu(null)
      } else {
        const numericFolderId = parseInt(contextMenu.node.id.replace('folder-', ''))
        console.log('Moving folder:', numericFolderId, 'to parent:', targetFolderId)
        const result = await window.electron.moveFolder(numericFolderId, targetFolderId) as any

        console.log('moveFolder result:', result)

        // Check if we got a duplicate folder error
        if (result && result.errorCode === 'DUPLICATE_FOLDER_NAME') {
          // Show merge confirmation modal
          setMergeModal({
            folderName: contextMenu.node.name,
            sourceFolderId: numericFolderId,
            targetFolderId: targetFolderId
          })
          setContextMenu(null)
        } else if (result && result.success) {
          console.log('Move successful, reloading tree')
          await loadTreeData()
          setContextMenu(null)
        }
      }
    } catch (error) {
      console.error('Failed to move:', error)
      alert('Failed to move: ' + error)
    }
  }

  const handleAddTo = async (targetFolderId: number) => {
    if (!contextMenu || contextMenu.node.type !== 'file') return

    console.log('handleAddTo called:', { nodeId: contextMenu.node.id, targetFolderId })

    try {
      const numericFileId = parseInt(contextMenu.node.id.replace('file-', ''))
      console.log('Adding file:', numericFileId, 'to folder:', targetFolderId)
      await window.electron.includeFileInFolder(numericFileId, targetFolderId)

      console.log('Add successful, reloading tree')
      await loadTreeData()
      setContextMenu(null)
    } catch (error) {
      console.error('Failed to add to folder:', error)
      alert('Failed to add to folder: ' + error)
    }
  }

  const handleRemoveFromFolder = async () => {
    if (!contextMenu || contextMenu.node.type !== 'file') return

    const fileId = parseInt(contextMenu.node.id.replace('file-', ''))
    const folderId = contextMenu.folderId

    try {
      await window.electron.removeFileFromFolder(fileId, folderId)
      await loadTreeData()
      setContextMenu(null)
    } catch (error) {
      console.error('Failed to remove file from folder:', error)
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
        if (contextMenu.node.type === 'file') {
          await window.electron.deleteFile(id)
        } else {
          await window.electron.removeFolder(id)
        }
        await loadTreeData()
        setContextMenu(null)
      } catch (error) {
        console.error('Failed to delete:', error)
      }
    }
  }

  const handleDeleteFolder = async () => {
    if (!contextMenu || contextMenu.node.type !== 'folder') return

    const confirmMessage = `Are you sure you want to delete the folder "${contextMenu.node.name}"? This will cascade delete all subfolders and remove files (deleting unique files).`

    if (window.confirm(confirmMessage)) {
      try {
        const id = parseInt(contextMenu.node.id.replace('folder-', ''))
        await window.electron.removeFolder(id)
        await loadTreeData()
        setContextMenu(null)
      } catch (error) {
        console.error('Failed to delete folder:', error)
      }
    }
  }

  const handleImportFile = async () => {
    try {
      await window.electron.selectAndImportFiles()
      await loadTreeData()
    } catch (error) {
      console.error('Failed to import files:', error)
    }
  }

  const handleReferenceFile = async () => {
    try {
      await window.electron.selectAndReferenceFiles()
      await loadTreeData()
    } catch (error) {
      console.error('Failed to reference files:', error)
    }
  }

  const handleCreateFolder = () => {
    setFolderParentId(null)
    setShowFolderInput(true)
  }

  const handleAddFolderToParent = (parentFolderId: number) => {
    setFolderParentId(parentFolderId)
    setShowFolderInput(true)
    setContextMenu(null)
  }

  const handleAddFileToFolder = async (folderId: number) => {
    console.log('handleAddFileToFolder called with folderId:', folderId)
    setContextMenu(null)
    try {
      console.log('Calling selectAndImportFilesToFolder...')
      const result = await window.electron.selectAndImportFilesToFolder(folderId)
      console.log('Import result:', result)

      await loadTreeData()
    } catch (error) {
      console.error('Failed to import files:', error)
    }
  }

  const handleReferenceFileToFolder = async (folderId: number) => {
    console.log('handleReferenceFileToFolder called with folderId:', folderId)
    setContextMenu(null)
    try {
      console.log('Calling selectAndReferenceFilesToFolder...')
      const result = await window.electron.selectAndReferenceFilesToFolder(folderId)
      console.log('Reference result:', result)

      await loadTreeData()
    } catch (error) {
      console.error('Failed to reference files:', error)
    }
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
      await window.electron.createFolder(folderName.trim(), parentIdForApi)

      await loadTreeData()
      setFolderName('')
      setFolderParentId(null)
      setShowFolderInput(false)
    } catch (error) {
      console.error('Failed to create folder:', error)
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

  const handleMergeConfirm = async () => {
    if (!mergeModal) return

    try {
      const result = await window.electron.moveFolder(mergeModal.sourceFolderId, mergeModal.targetFolderId, true) as any
      if (result && result.success) {
        console.log('Merge successful, reloading tree')
        await loadTreeData()
      } else {
        alert('Failed to merge folders')
      }
    } catch (error) {
      console.error('Failed to merge:', error)
      alert('Failed to merge folders: ' + error)
    } finally {
      setMergeModal(null)
    }
  }

  const handleMergeCancel = () => {
    setMergeModal(null)
  }

  return (
    <>
      <DirectoryHeader onUploadFile={handleImportFile} onReferenceFile={handleReferenceFile} onCreateFolder={handleCreateFolder} />

      {showFolderInput && (
        <FolderInputForm
          folderName={folderName}
          onFolderNameChange={setFolderName}
          onSubmit={submitFolder}
          onCancel={cancelFolder}
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

      {mergeModal && (
        <MergeFolderModal
          folderName={mergeModal.folderName}
          onConfirm={handleMergeConfirm}
          onCancel={handleMergeCancel}
        />
      )}
    </>
  )
}

export default DirectoryTree
