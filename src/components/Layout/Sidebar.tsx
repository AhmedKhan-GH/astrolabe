import { useState, useEffect, useCallback } from 'react'
import FileTreeView, { type TreeNode } from '../FileTree/FileTreeView'
import ContextMenu from '../FileTree/ContextMenu'
import FolderPickerModal from '../FileTree/FolderPickerModal'
import { buildFileTree } from '../FileTree/buildFileTree'
import DirectoryHeader from './DirectoryHeader'
import FolderInputForm from './FolderInputForm'
import { useResizable } from '../../hooks/useResizable'
import type { Folder, File } from '../../db/schema'

interface SidebarProps {
  isOpen: boolean
}

interface ContextMenuState {
  node: TreeNode
  x: number
  y: number
}

function Sidebar({ isOpen }: SidebarProps) {
  const { width, startResizing } = useResizable(250, 150, 600)
  const [treeData, setTreeData] = useState<TreeNode[]>([])
  const [showFolderInput, setShowFolderInput] = useState(false)
  const [folderName, setFolderName] = useState('')
  const [folderParentId, setFolderParentId] = useState<number | null>(null)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [allFolders, setAllFolders] = useState<Folder[]>([])
  const [allFiles, setAllFiles] = useState<File[]>([])
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set())
  const [showUploadPicker, setShowUploadPicker] = useState(false)
  const [showNewFolderPicker, setShowNewFolderPicker] = useState(false)

  const loadTreeData = useCallback(async () => {
    try {
      const [folders, files] = await Promise.all([
        window.electron.getAllFolders(),
        window.electron.getAllFiles()
      ])

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

  const handleNodeClick = (node: TreeNode) => {
    console.log('Clicked node:', node)
    // Handle file/folder click here
  }

  const handleNodeContextMenu = (node: TreeNode, e: React.MouseEvent) => {
    e.preventDefault()
    setContextMenu({ node, x: e.clientX, y: e.clientY })
  }

  const handleToggleExpand = (nodeId: string) => {
    setExpandedNodes(prev => {
      const next = new Set(prev)
      if (next.has(nodeId)) {
        next.delete(nodeId)
      } else {
        next.add(nodeId)
      }
      return next
    })
  }

  const handleMoveTo = async (targetFolderId: number | null) => {
    if (!contextMenu) return

    console.log('handleMoveTo called:', { nodeType: contextMenu.node.type, nodeId: contextMenu.node.id, targetFolderId })

    try {
      if (contextMenu.node.type === 'file') {
        const numericFileId = parseInt(contextMenu.node.id.replace('file-', ''))
        console.log('Moving file:', numericFileId, 'to folder:', targetFolderId)
        await window.electron.moveFile(numericFileId, targetFolderId)
      } else {
        const numericFolderId = parseInt(contextMenu.node.id.replace('folder-', ''))
        console.log('Moving folder:', numericFolderId, 'to parent:', targetFolderId)
        await window.electron.moveFolder(numericFolderId, targetFolderId)
      }

      // Expand the destination folder (if not root)
      if (targetFolderId !== 0) {
        setExpandedNodes(prev => new Set(prev).add(`folder-${targetFolderId}`))
      }

      console.log('Move successful, reloading tree')
      await loadTreeData()
      setContextMenu(null)
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

      // Expand the destination folder
      setExpandedNodes(prev => new Set(prev).add(`folder-${targetFolderId}`))

      console.log('Add successful, reloading tree')
      await loadTreeData()
      setContextMenu(null)
    } catch (error) {
      console.error('Failed to add to folder:', error)
      alert('Failed to add to folder: ' + error)
    }
  }

  const handleDeleteNode = async () => {
    if (!contextMenu) return

    const confirmMessage = contextMenu.node.type === 'file'
      ? `Are you sure you want to delete "${contextMenu.node.name}"?`
      : `Are you sure you want to delete the folder "${contextMenu.node.name}"? This will not delete the files inside.`

    if (window.confirm(confirmMessage)) {
      try {
        const id = parseInt(contextMenu.node.id.replace(/^(file|folder)-/, ''))
        if (contextMenu.node.type === 'file') {
          await window.electron.deleteFile(id)
        } else {
          await window.electron.deleteFolder(id)
        }
        await loadTreeData()
        setContextMenu(null)
      } catch (error) {
        console.error('Failed to delete:', error)
      }
    }
  }


  const handleUploadFile = async () => {
    setShowUploadPicker(true)
  }

  const handleUploadToFolder = async (folderId: number | null) => {
    setShowUploadPicker(false)
    try {
      if (folderId === null) {
        await window.electron.selectAndUploadFiles()
      } else {
        await window.electron.selectAndUploadFilesToFolder(folderId)
        // Expand the folder to show the newly added file
        setExpandedNodes(prev => new Set(prev).add(`folder-${folderId}`))
      }
      await loadTreeData()
    } catch (error) {
      console.error('Failed to upload files:', error)
    }
  }

  const handleCreateFolder = () => {
    setShowNewFolderPicker(true)
  }

  const handleCreateFolderInParent = (parentId: number | null) => {
    setShowNewFolderPicker(false)
    setFolderParentId(parentId)
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
      console.log('Calling selectAndUploadFilesToFolder...')
      const result = await window.electron.selectAndUploadFilesToFolder(folderId)
      console.log('Upload result:', result)

      // Expand the folder to show the newly added file
      setExpandedNodes(prev => new Set(prev).add(`folder-${folderId}`))

      await loadTreeData()
    } catch (error) {
      console.error('Failed to upload files:', error)
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
      await window.electron.createFolder(folderName.trim(), folderParentId ?? undefined)

      // If creating a subfolder, expand the parent
      if (folderParentId !== null) {
        setExpandedNodes(prev => new Set(prev).add(`folder-${folderParentId}`))
      }

      await loadTreeData()
      setFolderName('')
      setFolderParentId(null)
      setShowFolderInput(false)
    } catch (error) {
      console.error('Failed to create folder:', error)
      alert(error instanceof Error ? error.message : 'Failed to create folder')
    }
  }

  const cancelFolder = () => {
    setFolderName('')
    setFolderParentId(null)
    setShowFolderInput(false)
  }


  if (!isOpen) return null

  return (
    <div
      className="bg-slate-800 border-r border-slate-700 flex"
      style={{ width: `${width}px` }}
    >
      <div className="flex-1 overflow-y-auto p-4">
        <DirectoryHeader onUploadFile={handleUploadFile} onCreateFolder={handleCreateFolder} />

        {showFolderInput && (
          <FolderInputForm
            folderName={folderName}
            onFolderNameChange={setFolderName}
            onSubmit={submitFolder}
            onCancel={cancelFolder}
          />
        )}

        <FileTreeView data={treeData} onNodeClick={handleNodeClick} onNodeContextMenu={handleNodeContextMenu} expandedNodes={expandedNodes} onToggleExpand={handleToggleExpand} />

        {contextMenu && (
          <ContextMenu
            node={contextMenu.node}
            x={contextMenu.x}
            y={contextMenu.y}
            allFolders={allFolders}
            allFiles={allFiles}
            onMoveTo={handleMoveTo}
            onAddTo={contextMenu.node.type === 'file' ? handleAddTo : undefined}
            onAddFolder={contextMenu.node.type === 'folder' ? handleAddFolderToParent : undefined}
            onAddFile={contextMenu.node.type === 'folder' ? handleAddFileToFolder : undefined}
            onDelete={handleDeleteNode}
            onClose={() => setContextMenu(null)}
          />
        )}

        {/* Upload file picker modal */}
        {showUploadPicker && (
          <FolderPickerModal
            allFolders={allFolders}
            showRoot={true}
            onSelect={handleUploadToFolder}
            onClose={() => setShowUploadPicker(false)}
          />
        )}

        {/* New folder picker modal */}
        {showNewFolderPicker && (
          <FolderPickerModal
            allFolders={allFolders}
            showRoot={true}
            onSelect={handleCreateFolderInParent}
            onClose={() => setShowNewFolderPicker(false)}
          />
        )}
      </div>
      <div
        className="w-1 cursor-col-resize hover:bg-blue-500 transition-colors"
        onMouseDown={startResizing}
      />
    </div>
  )
}

export default Sidebar
