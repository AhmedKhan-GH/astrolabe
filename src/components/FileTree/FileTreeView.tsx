import FileTreeNode from './FileTreeNode'

export interface TreeNode {
  id: string
  name: string
  type: 'file' | 'folder'
  storageType?: 'import' | 'reference' // Only for files
  children?: TreeNode[]
  isExpanded?: boolean // Only for folders, from database
}

interface FileTreeViewProps {
  data: TreeNode[]
  onNodeClick?: (node: TreeNode) => void
  onNodeContextMenu?: (node: TreeNode, e: React.MouseEvent) => void
  className?: string
  onToggleExpand?: (nodeId: string) => void
}

export default function FileTreeView({ data, onNodeClick, onNodeContextMenu, className = '', onToggleExpand }: FileTreeViewProps) {
  return (
    <div className={`text-slate-300 relative isolate ${className}`}>
      {data.map((node) => (
        <FileTreeNode key={node.id} node={node} level={0} onNodeClick={onNodeClick} onNodeContextMenu={onNodeContextMenu} onToggleExpand={onToggleExpand} />
      ))}
    </div>
  )
}
