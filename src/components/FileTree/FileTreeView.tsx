import FileTreeNode from './FileTreeNode'

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
}

export default function FileTreeView({ data, onNodeClick, onNodeDoubleClick, onNodeContextMenu, className = '', onToggleExpand, expandedNodes, hideActionButtons = false, highlightedNodeId }: FileTreeViewProps) {
  return (
    <div className={`text-slate-300 relative isolate ${className}`}>
      {data.map((node) => (
        <FileTreeNode key={node.id} node={node} level={0} parentFolderId={0} onNodeClick={onNodeClick} onNodeDoubleClick={onNodeDoubleClick} onNodeContextMenu={onNodeContextMenu} onToggleExpand={onToggleExpand} expandedNodes={expandedNodes} hideActionButtons={hideActionButtons} highlightedNodeId={highlightedNodeId} />
      ))}
    </div>
  )
}
