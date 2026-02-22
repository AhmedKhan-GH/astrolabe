import FileTreeNode from './FileTreeNode'
import type { Folder, File } from '../../db/schema'

export interface TreeNode {
  id: string
  name: string
  type: 'file' | 'folder'
  storageType?: 'import' | 'reference' // Only for files
  children?: TreeNode[]
  isExpanded?: boolean // Only for folders, from database
  isSystemRoot?: boolean // Only for the root folder
  isDisabled?: boolean // For greying out nodes that can't be selected
  isHighlighted?: boolean // For highlighting the current folder
}

interface FileTreeViewProps {
  data: TreeNode[]
  onNodeClick?: (node: TreeNode) => void
  onNodeDoubleClick?: (node: TreeNode) => void
  onNodeContextMenu?: (node: TreeNode, parentFolderId: number, e: React.MouseEvent) => void
  className?: string
  onToggleExpand?: (nodeId: string) => void
  expandedNodes?: Set<string>
  hideActionButtons?: boolean
  highlightedNodeId?: string
  onAddFolder?: (folderId: number) => void
  onAddFile?: (folderId: number) => void
  onReferenceFile?: (folderId: number) => void
  onExpandAll?: (folderId: number) => void
  onCollapseAll?: (folderId: number) => void
  onMoveTo?: (folderId: number) => void
  allFolders?: Folder[]
  allFiles?: (File & { folderIds: string })[]
}

export default function FileTreeView({ data, onNodeClick, onNodeDoubleClick, onNodeContextMenu, className = '', onToggleExpand, expandedNodes, hideActionButtons = false, highlightedNodeId, onAddFolder, onAddFile, onReferenceFile, onExpandAll, onCollapseAll, onMoveTo, allFolders, allFiles }: FileTreeViewProps) {
  return (
    <div className={`text-slate-300 relative isolate ${className}`}>
      {data.map((node) => (
        <FileTreeNode key={node.id} node={node} level={0} parentFolderId={0} onNodeClick={onNodeClick} onNodeDoubleClick={onNodeDoubleClick} onNodeContextMenu={onNodeContextMenu} onToggleExpand={onToggleExpand} expandedNodes={expandedNodes} hideActionButtons={hideActionButtons} highlightedNodeId={highlightedNodeId} onAddFolder={onAddFolder} onAddFile={onAddFile} onReferenceFile={onReferenceFile} onExpandAll={onExpandAll} onCollapseAll={onCollapseAll} onMoveTo={onMoveTo} allFolders={allFolders} allFiles={allFiles} />
      ))}
    </div>
  )
}
