import { useEffect, useMemo, useState } from 'react'
import FileTreeView, { type TreeNode } from './FileTreeView'
import type { Folder } from '../../db/schema'

interface FolderPickerModalProps {
  allFolders: Folder[]
  excludeFolderId?: number
  showRoot?: boolean
  onSelect: (folderId: number) => void
  onClose: () => void
}

export default function FolderPickerModal({ allFolders, excludeFolderId, showRoot = true, onSelect, onClose }: FolderPickerModalProps) {
  // Build folder hierarchy and convert to TreeNode format
  const { folderTree, initialExpandedNodes } = useMemo(() => {
    const folderMap: Record<number, TreeNode> = {}
    const rootFolders: TreeNode[] = []

    // Create folder nodes (include all folders, even the excluded one)
    allFolders.forEach((folder) => {
      folderMap[folder.id] = {
        id: `folder-${folder.id}`,
        name: folder.name,
        type: 'folder',
        children: []
      }
    })

    // Build hierarchy
    allFolders.forEach((folder) => {
      const node = folderMap[folder.id]
      if (folder.parentId !== 0 && folderMap[folder.parentId]) {
        folderMap[folder.parentId].children!.push(node)
      } else {
        rootFolders.push(node)
      }
    })

    // Find path to excluded folder and expand ancestors
    const expandedSet = new Set<string>()
    if (excludeFolderId !== undefined) {
      const findPathToFolder = (folderId: number): number[] => {
        const folder = allFolders.find(f => f.id === folderId)
        if (!folder) return []
        if (folder.parentId === 0) return [folderId]
        return [...findPathToFolder(folder.parentId), folderId]
      }

      const path = findPathToFolder(excludeFolderId)
      // Expand all ancestors (not the folder itself)
      path.slice(0, -1).forEach(id => {
        expandedSet.add(`folder-${id}`)
      })
    }

    return { folderTree: rootFolders, initialExpandedNodes: expandedSet }
  }, [allFolders, excludeFolderId])

  const [expandedNodes, setExpandedNodes] = useState(() => initialExpandedNodes)

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
          {showRoot && (
            <div
              className="flex items-center py-1.5 px-2 cursor-pointer text-sm rounded bg-green-700/20 border border-green-600/30 text-green-300 hover:bg-green-700/30 mb-1"
              onClick={() => onSelect(0)}
            >
              <svg className="w-4 h-4 text-green-400 mr-2 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
              </svg>
              <span>System Root</span>
            </div>
          )}

          <FileTreeView
            data={folderTree}
            onNodeClick={(node) => {
              // Extract folder ID from node.id (format: "folder-123")
              const folderId = parseInt(node.id.replace('folder-', ''))
              onSelect(folderId)
            }}
            expandedNodes={expandedNodes}
            onToggleExpand={handleToggleExpand}
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
