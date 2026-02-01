import { useState, useEffect } from 'react'
import { type TreeNode } from './TreeView'

interface ContextMenuProps {
  node: TreeNode
  x: number
  y: number
  allFolders: any[]
  allFiles: any[]
  onMoveTo: (folderId: number | null) => void
  onAddTo?: (folderId: number) => void
  onDelete: () => void
  onClose: () => void
}

export default function ContextMenu({
  node,
  x,
  y,
  allFolders,
  allFiles,
  onMoveTo,
  onAddTo,
  onDelete,
  onClose
}: ContextMenuProps) {
  const [submenuType, setSubmenuType] = useState<'move' | 'add' | null>(null)

  useEffect(() => {
    const handleClickOutside = () => {
      onClose()
    }
    document.addEventListener('click', handleClickOutside)
    return () => document.removeEventListener('click', handleClickOutside)
  }, [onClose])

  // Calculate available move options
  const getMoveOptions = () => {
    let hasRoot = false
    if (node.type === 'folder') {
      const folderId = parseInt(node.id.replace('folder-', ''))
      const folder = allFolders.find(f => f.id === folderId)
      hasRoot = !(folder && folder.parentId === null)
    } else if (node.type === 'file') {
      const fileId = parseInt(node.id.replace('file-', ''))
      const file = allFiles.find(f => f.id === fileId)
      hasRoot = !(file && (!file.folderIds || false))
    }

    const availableFolders = allFolders.filter((f) => {
      if (node.type === 'folder') {
        return f.id !== parseInt(node.id.replace('folder-', ''))
      }
      return true
    })

    return { hasRoot, availableFolders, hasOptions: hasRoot || availableFolders.length > 0 }
  }

  const moveOptions = getMoveOptions()
  const hasAddOptions = allFolders.length > 0

  return (
    <>
      <div
        className="fixed bg-slate-700 border border-slate-600 rounded shadow-lg py-1 z-50 min-w-[160px]"
        style={{ left: `${x}px`, top: `${y}px` }}
      >
        <button
          onMouseEnter={() => moveOptions.hasOptions && setSubmenuType('move')}
          disabled={!moveOptions.hasOptions}
          className={`w-full text-left px-3 py-1.5 text-sm flex items-center justify-between ${
            moveOptions.hasOptions
              ? 'text-slate-200 hover:bg-slate-600 cursor-pointer'
              : 'text-slate-500 cursor-not-allowed'
          }`}
        >
          Move to
          <svg className="w-3 h-3 shrink-0 opacity-50" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>
        {node.type === 'file' && onAddTo && (
          <button
            onMouseEnter={() => hasAddOptions && setSubmenuType('add')}
            disabled={!hasAddOptions}
            className={`w-full text-left px-3 py-1.5 text-sm flex items-center justify-between ${
              hasAddOptions
                ? 'text-slate-200 hover:bg-slate-600 cursor-pointer'
                : 'text-slate-500 cursor-not-allowed'
            }`}
          >
            Add to
            <svg className="w-3 h-3 shrink-0 opacity-50" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>
        )}
        <div className="h-px bg-slate-600 my-1" />
        <button
          onClick={(e) => {
            e.stopPropagation()
            onDelete()
          }}
          className="w-full text-left px-3 py-1.5 text-red-400 text-sm hover:bg-slate-600"
        >
          Delete
        </button>
      </div>

      {/* Move to submenu */}
      {submenuType === 'move' && (
        <div
          className="fixed bg-slate-700 border border-slate-600 rounded shadow-lg py-1 z-50 min-w-[160px]"
          style={{ left: `${x + 170}px`, top: `${y}px` }}
          onMouseLeave={() => setSubmenuType(null)}
        >
          {(() => {
            // Check if node is already in root
            let isInRoot = false
            if (node.type === 'folder') {
              const folderId = parseInt(node.id.replace('folder-', ''))
              const folder = allFolders.find(f => f.id === folderId)
              isInRoot = folder && folder.parentId === null
            } else if (node.type === 'file') {
              const fileId = parseInt(node.id.replace('file-', ''))
              const file = allFiles.find(f => f.id === fileId)
              isInRoot = file && (!file.folderIds || file.folderIds === null)
            }

            return !isInRoot && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onMoveTo(null)
                }}
                className="w-full text-left px-3 py-1.5 text-slate-200 text-sm hover:bg-slate-600"
              >
                Root
              </button>
            )
          })()}
          {allFolders
            .filter((f) => {
              // For folders, exclude itself
              if (node.type === 'folder') {
                return f.id !== parseInt(node.id.replace('folder-', ''))
              }
              return true
            })
            .map((folder) => (
              <button
                key={folder.id}
                onClick={(e) => {
                  e.stopPropagation()
                  onMoveTo(folder.id)
                }}
                className="w-full text-left px-3 py-1.5 text-slate-200 text-sm hover:bg-slate-600 flex items-center gap-2"
              >
                <svg className="w-3 h-3 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                </svg>
                {folder.name}
              </button>
            ))}
        </div>
      )}

      {/* Add to submenu */}
      {submenuType === 'add' && node.type === 'file' && onAddTo && (
        <div
          className="fixed bg-slate-700 border border-slate-600 rounded shadow-lg py-1 z-50 min-w-[160px]"
          style={{ left: `${x + 170}px`, top: `${y + 32}px` }}
          onMouseLeave={() => setSubmenuType(null)}
        >
          {allFolders.length === 0 ? (
            <div className="px-3 py-2 text-slate-400 text-sm">No folders available</div>
          ) : (
            allFolders.map((folder) => (
              <button
                key={folder.id}
                onClick={(e) => {
                  e.stopPropagation()
                  onAddTo(folder.id)
                }}
                className="w-full text-left px-3 py-1.5 text-slate-200 text-sm hover:bg-slate-600 flex items-center gap-2"
              >
                <svg className="w-3 h-3 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                </svg>
                {folder.name}
              </button>
            ))
          )}
        </div>
      )}
    </>
  )
}
