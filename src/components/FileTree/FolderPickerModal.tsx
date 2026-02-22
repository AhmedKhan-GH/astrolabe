import { useEffect, useMemo, useState } from 'react'
import FileTreeView, { type TreeNode } from './FileTreeView'
import type { Folder } from '../../db/schema'
import { UI_LABELS } from '../../config/constants'

interface FolderPickerModalProps {
  allFolders: Folder[]
  onSelect: (folderId: number) => void
  onClose: () => void
  greyedOutFolderIds?: number[]  // Folders to grey out (disabled)
  currentFolderId?: number  // Current folder (for context)
}

export default function FolderPickerModal({ allFolders, onSelect, onClose, greyedOutFolderIds = [], currentFolderId }: FolderPickerModalProps) {
  // Build folder hierarchy and convert to TreeNode format with Directory
  const treeData = useMemo(() => {
    const folderMap: Record<number, TreeNode> = {}
    const rootFolders: TreeNode[] = []
    const greyedOutSet = new Set(greyedOutFolderIds)

    // Create folder nodes (all folders, no exclusions)
    allFolders.forEach((folder) => {
      folderMap[folder.id] = {
        id: `folder-${folder.id}`,
        name: folder.name,
        type: 'folder',
        children: [],
        isExpanded: folder.isExpanded,
        isDisabled: greyedOutSet.has(folder.id)
      }
    })

    // Build hierarchy
    allFolders.forEach((folder) => {
      const node = folderMap[folder.id]
      if (!node) return

      if (folder.parentId !== 0 && folderMap[folder.parentId]) {
        folderMap[folder.parentId].children!.push(node)
      } else {
        rootFolders.push(node)
      }
    })

    // Create Directory node that contains everything
    const systemRootNode: TreeNode = {
      id: 'folder-0',
      name: UI_LABELS.DIRECTORY,
      type: 'folder',
      children: rootFolders,
      isExpanded: true,
      isSystemRoot: true,
      isDisabled: greyedOutSet.has(0)
    }

    return [systemRootNode]
  }, [allFolders, greyedOutFolderIds])

  // Function to get all ancestor folder IDs
  const getAncestorIds = (folderId: number): number[] => {
    const ancestors: number[] = []
    let currentId = folderId

    while (currentId !== 0) {
      const folder = allFolders.find(f => f.id === currentId)
      if (!folder) break
      ancestors.push(currentId)
      currentId = folder.parentId
    }

    return ancestors
  }

  // Initialize expanded nodes to include current folder and all its ancestors
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(() => {
    const initialExpanded = new Set<string>(['folder-0']) // Always expand root

    if (currentFolderId !== undefined) {
      const ancestorIds = getAncestorIds(currentFolderId)
      ancestorIds.forEach(id => {
        initialExpanded.add(`folder-${id}`)
      })
    }

    return initialExpanded
  })

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
              // Don't allow clicking disabled nodes
              if (node.isDisabled) return
              // Extract folder ID from node.id (format: "folder-123")
              const folderId = parseInt(node.id.replace('folder-', ''))
              onSelect(folderId)
            }}
            expandedNodes={expandedNodes}
            onToggleExpand={handleToggleExpand}
            hideActionButtons={true}
            highlightedNodeId={currentFolderId !== undefined ? `folder-${currentFolderId}` : undefined}
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
