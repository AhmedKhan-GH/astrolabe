import { useState, useEffect } from 'react'
import { type TreeNode } from './FileTreeView'
import type { Folder, File } from '../../db/schema'
import FolderPickerModal from './FolderPickerModal'

interface ContextMenuProps {
  node: TreeNode
  x: number
  y: number
  allFolders: Folder[]
  allFiles: (File & { folderIds: string })[]
  currentFolderId: number
  onMoveTo: (folderId: number) => void
  onAddTo?: (folderId: number) => void
  onAddContentsTo?: (targetFolderId: number) => void
  onAddFolder?: (parentFolderId: number) => void
  onAddFile?: (folderId: number) => void
  onReferenceFile?: (folderId: number) => void
  onRemove?: () => void
  onDelete: () => void
  onDeleteFolder?: () => void
  onExpandAll?: (folderId: number) => void
  onCollapseAll?: (folderId: number) => void
  onClose: () => void
}

export default function ContextMenu({
  node,
  x,
  y,
  allFolders,
  allFiles,
  currentFolderId,
  onMoveTo,
  onAddTo,
  onAddContentsTo,
  onAddFolder,
  onAddFile,
  onReferenceFile,
  onRemove,
  onDelete,
  onDeleteFolder,
  onExpandAll,
  onCollapseAll,
  onClose
}: ContextMenuProps) {
  const [showMovePicker, setShowMovePicker] = useState(false)
  const [showAddPicker, setShowAddPicker] = useState(false)
  const [showAddContentsPicker, setShowAddContentsPicker] = useState(false)

  // Check if this file exists in multiple folders
  const fileExistsInMultipleFolders = node.type === 'file' ? (() => {
    const fileId = parseInt(node.id.replace('file-', ''))
    const file = allFiles.find(f => f.id === fileId)
    if (!file?.folderIds) return false
    const folderIds = JSON.parse(file.folderIds)
    return folderIds.length > 1
  })() : false

  // Helper to get all descendant folder IDs (including the folder itself)
  const getAllDescendantIds = (folderId: number): number[] => {
    const descendants = [folderId]
    const children = allFolders.filter(f => f.parentId === folderId)
    children.forEach(child => {
      descendants.push(...getAllDescendantIds(child.id))
    })
    return descendants
  }

  // Calculate which folders to grey out for "Move to" based on node type
  const getGreyedOutFoldersForMove = (): number[] => {
    if (node.type === 'folder') {
      const folderId = parseInt(node.id.replace('folder-', ''))
      const folder = allFolders.find(f => f.id === folderId)
      // Grey out: the folder itself, all its descendants, and its parent (current location)
      const greyedOut = getAllDescendantIds(folderId)
      if (folder?.parentId !== undefined) {
        greyedOut.push(folder.parentId)
      }
      return greyedOut
    } else if (node.type === 'file') {
      // Grey out folders where the file is already located
      const fileId = parseInt(node.id.replace('file-', ''))
      const file = allFiles.find(f => f.id === fileId)
      if (!file?.folderIds) return []
      return JSON.parse(file.folderIds)
    }
    return []
  }

  // Calculate which folders to grey out for "Add to" (only for files)
  const getGreyedOutFoldersForAdd = (): number[] => {
    if (node.type === 'file') {
      const fileId = parseInt(node.id.replace('file-', ''))
      const file = allFiles.find(f => f.id === fileId)
      if (!file?.folderIds) return []
      return JSON.parse(file.folderIds)
    }
    return []
  }

  // Calculate which folders to grey out for "Add Contents To" (for folders)
  const getGreyedOutFoldersForAddContents = (): number[] => {
    if (node.type === 'folder') {
      const folderId = parseInt(node.id.replace('folder-', ''))
      // Grey out the folder itself and all its descendants
      return getAllDescendantIds(folderId).concat([folderId])
    }
    return []
  }

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
            {node.type === 'folder' && onAddContentsTo && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  setShowAddContentsPicker(true)
                }}
                className="w-full text-left px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-600 cursor-pointer"
              >
                Add To
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
                  onReferenceFile(folderId)
                }}
                className="w-full text-left px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-600"
              >
                Reference File
              </button>
            )}
            {node.type === 'folder' && (onExpandAll || onCollapseAll) && (
              <>
                <div className="h-px bg-slate-600 my-1" />
                {onExpandAll && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      const folderId = parseInt(node.id.replace('folder-', ''))
                      onExpandAll(folderId)
                    }}
                    className="w-full text-left px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-600"
                  >
                    Expand All
                  </button>
                )}
                {onCollapseAll && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      const folderId = parseInt(node.id.replace('folder-', ''))
                      onCollapseAll(folderId)
                    }}
                    className="w-full text-left px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-600"
                  >
                    Collapse All
                  </button>
                )}
              </>
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
          currentFolderId={currentFolderId}
          greyedOutFolderIds={getGreyedOutFoldersForMove()}
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
          currentFolderId={currentFolderId}
          greyedOutFolderIds={getGreyedOutFoldersForAdd()}
          onSelect={(folderId) => {
            onAddTo(folderId)
            setShowAddPicker(false)
          }}
          onClose={() => setShowAddPicker(false)}
        />
      )}

      {/* Add Contents To picker modal */}
      {showAddContentsPicker && node.type === 'folder' && onAddContentsTo && (
        <FolderPickerModal
          allFolders={allFolders}
          currentFolderId={currentFolderId}
          greyedOutFolderIds={getGreyedOutFoldersForAddContents()}
          onSelect={(folderId) => {
            onAddContentsTo(folderId)
            setShowAddContentsPicker(false)
          }}
          onClose={() => setShowAddContentsPicker(false)}
        />
      )}

    </>
  )
}
