import { useState, useEffect } from 'react'
import TreeView, { type TreeNode } from '../TreeView'

interface SidebarProps {
  isOpen: boolean
}

function Sidebar({ isOpen }: SidebarProps) {
  const [width, setWidth] = useState(250)
  const [isResizing, setIsResizing] = useState(false)
  const [treeData, setTreeData] = useState<TreeNode[]>([])
  const [showFolderInput, setShowFolderInput] = useState(false)
  const [folderName, setFolderName] = useState('')

  const loadTreeData = async () => {
    try {
      const [folders, files] = await Promise.all([
        window.electron.getAllFolders(),
        window.electron.getAllFiles()
      ])

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
          folderMap[folder.parentId].children!.push(node)
        } else {
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
          folderIds.forEach((folderId: number) => {
            if (folderMap[folderId]) {
              folderMap[folderId].children!.push(fileNode)
            }
          })
        } else {
          // File not in any folder, add to root
          rootFolders.push(fileNode)
        }
      })

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

  const handleUploadFile = async () => {
    try {
      await window.electron.selectAndUploadFiles()
      await loadTreeData()
    } catch (error) {
      console.error('Failed to upload files:', error)
    }
  }

  const handleCreateFolder = () => {
    setShowFolderInput(true)
  }

  const submitFolder = async () => {
    if (folderName.trim()) {
      try {
        await window.electron.createFolder(folderName.trim())
        await loadTreeData()
        setFolderName('')
        setShowFolderInput(false)
      } catch (error) {
        console.error('Failed to create folder:', error)
      }
    }
  }

  const cancelFolder = () => {
    setFolderName('')
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
          <h2 className="text-white text-lg font-semibold">Files</h2>
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

        <TreeView data={treeData} onNodeClick={handleNodeClick} />
      </div>
      <div
        className="w-1 cursor-col-resize hover:bg-blue-500 transition-colors"
        onMouseDown={() => setIsResizing(true)}
      />
    </div>
  )
}

export default Sidebar
