import FileTreeNode from './FileTreeNode'

export interface TreeNode {
  id: string
  name: string
  type: 'file' | 'folder'
  children?: TreeNode[]
}

interface FileTreeViewProps {
  data: TreeNode[]
  onNodeClick?: (node: TreeNode) => void
  onNodeContextMenu?: (node: TreeNode, e: React.MouseEvent) => void
  className?: string
  expandedNodes?: Set<string>
  onToggleExpand?: (nodeId: string) => void
}

export default function FileTreeView({ data, onNodeClick, onNodeContextMenu, className = '', expandedNodes, onToggleExpand }: FileTreeViewProps) {
  return (
    <div className={`text-slate-300 relative isolate ${className}`}>
      {data.map((node) => (
        <FileTreeNode key={node.id} node={node} level={0} onNodeClick={onNodeClick} onNodeContextMenu={onNodeContextMenu} expandedNodes={expandedNodes} onToggleExpand={onToggleExpand} />
      ))}
    </div>
  )
}
