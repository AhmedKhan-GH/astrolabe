import { useState, useEffect } from 'react'
import { type TreeNode } from './FileTreeView'
import type { Folder, File } from '../../db/schema'
import FolderPickerModal from './FolderPickerModal'

interface ContextMenuProps {
  node: TreeNode
  x: number
  y: number
  allFolders: Folder[]
  allFiles: File[]
  onMoveTo: (folderId: number | null) => void
  onAddTo?: (folderId: number) => void
  onAddFolder?: (parentFolderId: number) => void
  onAddFile?: (folderId: number) => void
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
  onAddFolder,
  onAddFile,
  onDelete,
  onClose
}: ContextMenuProps) {
  const [showMovePicker, setShowMovePicker] = useState(false)
  const [showAddPicker, setShowAddPicker] = useState(false)

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
        className="fixed bg-slate-700 border border-slate-600 rounded shadow-lg py-1 z-50 w-[140px]"
        style={{ left: `${x}px`, top: `${y}px` }}
      >
        <button
          onClick={(e) => {
            e.stopPropagation()
            if (moveOptions.hasOptions) {
              setShowMovePicker(true)
            }
          }}
          disabled={!moveOptions.hasOptions}
          className={`w-full text-left px-3 py-1.5 text-sm ${
            moveOptions.hasOptions
              ? 'text-slate-200 hover:bg-slate-600 cursor-pointer'
              : 'text-slate-500 cursor-not-allowed'
          }`}
        >
          Move to
        </button>
        {node.type === 'file' && onAddTo && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              if (hasAddOptions) {
                setShowAddPicker(true)
              }
            }}
            disabled={!hasAddOptions}
            className={`w-full text-left px-3 py-1.5 text-sm ${
              hasAddOptions
                ? 'text-slate-200 hover:bg-slate-600 cursor-pointer'
                : 'text-slate-500 cursor-not-allowed'
            }`}
          >
            Add to
          </button>
        )}
        {node.type === 'folder' && onAddFolder && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              const folderId = parseInt(node.id.replace('folder-', ''))
              onAddFolder(folderId)
            }}
            className="w-full text-left px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-600"
          >
            New Folder
          </button>
        )}
        {node.type === 'folder' && onAddFile && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              const folderId = parseInt(node.id.replace('folder-', ''))
              console.log('Import File clicked for folder:', folderId)
              onAddFile(folderId)
            }}
            className="w-full text-left px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-600"
          >
            Import File
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

      {/* Move to picker modal */}
      {showMovePicker && (
        <FolderPickerModal
          allFolders={allFolders}
          excludeFolderId={node.type === 'folder' ? parseInt(node.id.replace('folder-', '')) : undefined}
          showRoot={(() => {
            // Check if node is already in root
            if (node.type === 'folder') {
              const folderId = parseInt(node.id.replace('folder-', ''))
              const folder = allFolders.find(f => f.id === folderId)
              return !(folder && folder.parentId === null)
            } else if (node.type === 'file') {
              const fileId = parseInt(node.id.replace('file-', ''))
              const file = allFiles.find(f => f.id === fileId)
              return !(file && (!file.folderIds || file.folderIds === null))
            }
            return true
          })()}
          onSelect={(folderId) => {
            onMoveTo(folderId)
            setShowMovePicker(false)
          }}
          onClose={() => setShowMovePicker(false)}
        />
      )}

      {/* Add to picker modal */}
      {showAddPicker && node.type === 'file' && onAddTo && (
        <FolderPickerModal
          allFolders={allFolders}
          showRoot={false}
          onSelect={(folderId) => {
            if (folderId !== null) {
              onAddTo(folderId)
            }
            setShowAddPicker(false)
          }}
          onClose={() => setShowAddPicker(false)}
        />
      )}

    </>
  )
}
