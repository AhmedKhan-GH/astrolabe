import { useState, useEffect } from 'react'

interface FolderPickerModalProps {
  allFolders: any[]
  excludeFolderId?: number
  showRoot?: boolean
  onSelect: (folderId: number | null) => void
  onClose: () => void
}

interface FolderTreeNodeProps {
  folder: any
  level: number
  onSelect: (folderId: number | null) => void
  excludeFolderId?: number
  children: any[]
}

function FolderTreeNode({ folder, level, onSelect, excludeFolderId, children }: FolderTreeNodeProps) {
  const [isExpanded, setIsExpanded] = useState(true)
  const hasChildren = children.length > 0
  const isExcluded = excludeFolderId === folder.id

  if (isExcluded) return null

  return (
    <div>
      <div
        className="flex items-center py-1.5 hover:bg-slate-600/50 cursor-pointer text-sm"
        style={{ paddingLeft: `${level * 20 + 8}px` }}
      >
        <div className="w-4 mr-2 flex-shrink-0" onClick={() => hasChildren && setIsExpanded(!isExpanded)}>
          {hasChildren && (
            <svg
              className="w-4 h-4 text-slate-400"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              viewBox="0 0 24 24"
            >
              {isExpanded ? (
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              )}
            </svg>
          )}
        </div>

        <div className="flex items-center gap-2 flex-1" onClick={() => onSelect(folder.id)}>
          <svg className="w-4 h-4 text-slate-400 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
          </svg>
          <span className="text-slate-200">{folder.name}</span>
        </div>
      </div>

      {isExpanded && hasChildren && (
        <div>
          {children.map((child) => (
            <FolderTreeNode
              key={child.id}
              folder={child}
              level={level + 1}
              onSelect={onSelect}
              excludeFolderId={excludeFolderId}
              children={child.children || []}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export default function FolderPickerModal({ allFolders, excludeFolderId, showRoot = true, onSelect, onClose }: FolderPickerModalProps) {
  // Build folder hierarchy
  const buildFolderTree = () => {
    const folderMap: Record<number, any> = {}
    const rootFolders: any[] = []

    // Create folder objects with children array
    allFolders.forEach((folder) => {
      folderMap[folder.id] = { ...folder, children: [] }
    })

    // Build hierarchy
    allFolders.forEach((folder) => {
      const node = folderMap[folder.id]
      if (folder.parentId && folderMap[folder.parentId]) {
        folderMap[folder.parentId].children.push(node)
      } else {
        rootFolders.push(node)
      }
    })

    return rootFolders
  }

  const folderTree = buildFolderTree()

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [onClose])

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-slate-800 border border-slate-600 rounded-lg shadow-xl w-96 max-h-[500px] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-slate-600">
          <h3 className="text-white font-semibold">Select Folder</h3>
        </div>

        <div className="overflow-y-auto flex-1 p-2">
          {showRoot && (
            <div
              className="flex items-center py-1.5 px-2 hover:bg-slate-600/50 cursor-pointer text-sm rounded"
              onClick={() => onSelect(null)}
            >
              <svg className="w-4 h-4 mr-2 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
              </svg>
            </div>
          )}

          {folderTree.map((folder) => (
            <FolderTreeNode
              key={folder.id}
              folder={folder}
              level={0}
              onSelect={onSelect}
              excludeFolderId={excludeFolderId}
              children={folder.children || []}
            />
          ))}
        </div>

        <div className="px-4 py-3 border-t border-slate-600 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white text-sm rounded transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
