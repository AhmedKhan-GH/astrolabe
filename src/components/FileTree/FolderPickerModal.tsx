import { useEffect, useMemo, useState } from 'react'
import FileTreeView, { type TreeNode } from './FileTreeView'
import type { Folder } from '../../db/schema'

interface FolderPickerModalProps {
  allFolders: Folder[]
  onSelect: (folderId: number) => void
  onClose: () => void
  excludeFolderIds?: number[]  // Folders to exclude from selection
  currentFolderId?: number  // Current folder (for context)
}

export default function FolderPickerModal({ allFolders, onSelect, onClose, excludeFolderIds = [] }: FolderPickerModalProps) {
  // Build folder hierarchy and convert to TreeNode format with System Root
  const treeData = useMemo(() => {
    const folderMap: Record<number, TreeNode> = {}
    const rootFolders: TreeNode[] = []
    const excludeSet = new Set(excludeFolderIds)

    // Create folder nodes (excluding filtered ones)
    allFolders.forEach((folder) => {
      if (!excludeSet.has(folder.id)) {
        folderMap[folder.id] = {
          id: `folder-${folder.id}`,
          name: folder.name,
          type: 'folder',
          children: [],
          isExpanded: folder.isExpanded
        }
      }
    })

    // Build hierarchy
    allFolders.forEach((folder) => {
      const node = folderMap[folder.id]
      if (!node) return // Skip if excluded

      if (folder.parentId !== 0 && folderMap[folder.parentId]) {
        folderMap[folder.parentId].children!.push(node)
      } else {
        rootFolders.push(node)
      }
    })

    // Create System Root node that contains everything
    const systemRootNode: TreeNode = {
      id: 'folder-0',
      name: 'System Root',
      type: 'folder',
      children: rootFolders,
      isExpanded: true,
      isSystemRoot: true
    }

    return [systemRootNode]
  }, [allFolders, excludeFolderIds])

  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set())

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
          <FileTreeView
            data={treeData}
            onNodeClick={(node) => {
              // Extract folder ID from node.id (format: "folder-123")
              const folderId = parseInt(node.id.replace('folder-', ''))
              onSelect(folderId)
            }}
            expandedNodes={expandedNodes}
            onToggleExpand={handleToggleExpand}
            hideActionButtons={true}
          />
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
