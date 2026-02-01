import { useState, useEffect } from 'react'
import TreeView, { type TreeNode } from '../TreeView'
import ContextMenu from '../ContextMenu'
import FolderPickerModal from '../FolderPickerModal'

interface SidebarProps {
  isOpen: boolean
}

interface ContextMenuState {
  node: TreeNode
  x: number
  y: number
}

function Sidebar({ isOpen }: SidebarProps) {
  const [width, setWidth] = useState(250)
  const [isResizing, setIsResizing] = useState(false)
  const [treeData, setTreeData] = useState<TreeNode[]>([])
  const [showFolderInput, setShowFolderInput] = useState(false)
  const [folderName, setFolderName] = useState('')
  const [folderParentId, setFolderParentId] = useState<number | null>(null)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [allFolders, setAllFolders] = useState<any[]>([])
  const [allFiles, setAllFiles] = useState<any[]>([])
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set())
  const [showUploadPicker, setShowUploadPicker] = useState(false)
  const [showNewFolderPicker, setShowNewFolderPicker] = useState(false)

  const loadTreeData = async () => {
    try {
      const [folders, files] = await Promise.all([
        window.electron.getAllFolders(),
        window.electron.getAllFiles()
      ])

      console.log('Folders from DB:', folders)
      console.log('Files from DB:', files)

      setAllFolders(folders)
      setAllFiles(files)

      // Build folder hierarchy
      const folderMap: Record<number, TreeNode> = {}
      const rootFolders: TreeNode[] = []

      // Create folder nodes
      folders.forEach((folder: any) => {
        folderMap[folder.id] = {
          id: `folder-${folder.id}`,
          name: folder.name,
          type: 'folder',
          children: []
        }
      })

      // Build hierarchy
      folders.forEach((folder: any) => {
        const node = folderMap[folder.id]
        if (folder.parentId && folderMap[folder.parentId]) {
          console.log(`Adding folder ${folder.name} to parent ${folder.parentId}`)
          folderMap[folder.parentId].children!.push(node)
        } else {
          console.log(`Adding folder ${folder.name} to root`)
          rootFolders.push(node)
        }
      })

      // Add files to their folders (or root if no folders specified)
      files.forEach((file: any) => {
        const fileNode: TreeNode = {
          id: `file-${file.id}`,
          name: file.filename,
          type: 'file'
        }

        if (file.folderIds) {
          const folderIds = JSON.parse(file.folderIds)
          console.log(`File ${file.filename} has folderIds:`, folderIds)
          folderIds.forEach((folderId: number) => {
            if (folderMap[folderId]) {
              console.log(`Adding file ${file.filename} to folder ${folderId}`)
              folderMap[folderId].children!.push(fileNode)
            }
          })
        } else {
          console.log(`Adding file ${file.filename} to root`)
          rootFolders.push(fileNode)
        }
      })

      console.log('Final tree data:', rootFolders)
      setTreeData(rootFolders)
    } catch (error) {
      console.error('Failed to load tree data:', error)
    }
  }

  useEffect(() => {
    loadTreeData()
  }, [])

  const handleNodeClick = (node: TreeNode) => {
    console.log('Clicked node:', node)
    // Handle file/folder click here
  }

  const handleNodeContextMenu = (node: TreeNode, e: React.MouseEvent) => {
    e.preventDefault()
    setContextMenu({ node, x: e.clientX, y: e.clientY })
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
    if (folderName.trim()) {
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
      } catch (error: any) {
        console.error('Failed to create folder:', error)
        alert(error.message || 'Failed to create folder')
      }
    }
  }

  const cancelFolder = () => {
    setFolderName('')
    setFolderParentId(null)
    setShowFolderInput(false)
  }


  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return
      const newWidth = e.clientX
      if (newWidth >= 150 && newWidth <= 600) {
        setWidth(newWidth)
      }
    }

    const handleMouseUp = () => {
      setIsResizing(false)
    }

    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isResizing])

  if (!isOpen) return null

  return (
    <div
      className="bg-slate-800 border-r border-slate-700 flex"
      style={{ width: `${width}px` }}
    >
      <div className="flex-1 overflow-y-auto p-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-white text-lg font-semibold">Directory</h2>
          <div className="flex gap-1">
            <button
              onClick={handleUploadFile}
              className="flex items-center gap-1 px-1.5 py-1 rounded border border-slate-600 text-slate-300 hover:bg-slate-700/50 hover:text-white transition-colors"
              title="Upload file"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
              </svg>
            </button>
            <button
              onClick={handleCreateFolder}
              className="flex items-center gap-1 px-1.5 py-1 rounded border border-slate-600 text-slate-300 hover:bg-slate-700/50 hover:text-white transition-colors"
              title="Create folder"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
              </svg>
            </button>
          </div>
        </div>

        {showFolderInput && (
          <div className="mb-4 p-3 bg-slate-700/50 rounded border border-slate-600">
            <input
              type="text"
              value={folderName}
              onChange={(e) => setFolderName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitFolder()
                if (e.key === 'Escape') cancelFolder()
              }}
              placeholder="Folder name"
              autoFocus
              className="w-full px-2 py-1 bg-slate-800 border border-slate-600 rounded text-slate-200 text-sm focus:outline-none focus:border-slate-500 mb-2"
            />
            <div className="flex gap-2">
              <button
                onClick={submitFolder}
                className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded transition-colors"
              >
                Create
              </button>
              <button
                onClick={cancelFolder}
                className="px-3 py-1 bg-slate-600 hover:bg-slate-700 text-white text-sm rounded transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        <TreeView data={treeData} onNodeClick={handleNodeClick} onNodeContextMenu={handleNodeContextMenu} expandedNodes={expandedNodes} />

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
        onMouseDown={() => setIsResizing(true)}
      />
    </div>
  )
}

export default Sidebar
