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
  currentFolderId: number
  onMoveTo: (folderId: number) => void
  onAddTo?: (folderId: number) => void
  onAddFolder?: (parentFolderId: number) => void
  onAddFile?: (folderId: number) => void
  onReferenceFile?: (folderId: number) => void
  onRemove?: () => void
  onDelete: () => void
  onDeleteFolder?: () => void
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
  onReferenceFile,
  onRemove,
  onDelete,
  onDeleteFolder,
  onClose
}: ContextMenuProps) {
  const [showMovePicker, setShowMovePicker] = useState(false)
  const [showAddPicker, setShowAddPicker] = useState(false)

  // Check if this file exists in multiple folders
  const fileExistsInMultipleFolders = node.type === 'file' ? (() => {
    const fileId = parseInt(node.id.replace('file-', ''))
    const file = allFiles.find(f => f.id === fileId)
    if (!file?.folderIds) return false
    const folderIds = JSON.parse(file.folderIds)
    return folderIds.length > 1
  })() : false

  useEffect(() => {
    const handleClickOutside = () => {
      onClose()
    }
    document.addEventListener('click', handleClickOutside)
    return () => document.removeEventListener('click', handleClickOutside)
  }, [onClose])

  return (
    <>
      <div
        className="fixed bg-slate-700 border border-slate-600 rounded shadow-lg py-1 z-50 w-[140px]"
        style={{ left: `${x}px`, top: `${y}px` }}
      >
        <button
          onClick={(e) => {
            e.stopPropagation()
            setShowMovePicker(true)
          }}
          className="w-full text-left px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-600 cursor-pointer"
        >
          Move to
        </button>
        {node.type === 'file' && onAddTo && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              setShowAddPicker(true)
            }}
            className="w-full text-left px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-600 cursor-pointer"
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
        {node.type === 'folder' && onReferenceFile && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              const folderId = parseInt(node.id.replace('folder-', ''))
              console.log('Reference File clicked for folder:', folderId)
              onReferenceFile(folderId)
            }}
            className="w-full text-left px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-600"
          >
            Reference File
          </button>
        )}
        <div className="h-px bg-slate-600 my-1" />
        {node.type === 'file' && fileExistsInMultipleFolders && onRemove && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              onRemove()
            }}
            className="w-full text-left px-3 py-1.5 text-orange-400 text-sm hover:bg-slate-600"
          >
            Remove
          </button>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation()
            onDelete()
          }}
          className={`w-full text-left px-3 py-1.5 text-sm hover:bg-slate-600 ${node.type === 'folder' ? 'text-orange-400' : 'text-red-400'}`}
        >
          {node.type === 'folder' ? 'Remove' : 'Delete'}
        </button>
        {node.type === 'folder' && onDeleteFolder && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              onDeleteFolder()
            }}
            className="w-full text-left px-3 py-1.5 text-red-400 text-sm hover:bg-slate-600"
          >
            Delete
          </button>
        )}
      </div>

      {/* Move to picker modal */}
      {showMovePicker && (
        <FolderPickerModal
          allFolders={allFolders}
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
          onSelect={(folderId) => {
            onAddTo(folderId)
            setShowAddPicker(false)
          }}
          onClose={() => setShowAddPicker(false)}
        />
      )}

    </>
  )
}
