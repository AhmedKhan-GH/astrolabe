import { useState } from 'react'

export interface TreeNode {
  id: string
  name: string
  type: 'file' | 'folder'
  children?: TreeNode[]
}

interface TreeNodeComponentProps {
  node: TreeNode
  level: number
  onNodeClick?: (node: TreeNode) => void
  onNodeContextMenu?: (node: TreeNode, e: React.MouseEvent) => void
}

function TreeNodeComponent({ node, level, onNodeClick, onNodeContextMenu }: TreeNodeComponentProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const isFolder = node.type === 'folder'
  const hasChildren = node.children && node.children.length > 0

  const handleClick = () => {
    if (isFolder) {
      setIsExpanded(!isExpanded)
    }
    onNodeClick?.(node)
  }

  const handleContextMenu = (e: React.MouseEvent) => {
    onNodeContextMenu?.(node, e)
  }

  return (
    <div className="relative">
      <div
        className="flex items-center py-1.5 hover:bg-slate-700/50 cursor-pointer text-sm relative"
        style={{ paddingLeft: `${level * 20 + 8}px` }}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
      >
        {/* Vertical lines for parent levels */}
        {Array.from({ length: level }).map((_, i) => (
          <div
            key={i}
            className="absolute top-0 bottom-0 w-px bg-slate-600"
            style={{ left: `${i * 20 + 8 + 8}px` }}
          />
        ))}

        {/* Expand/collapse chevron */}
        <div className="w-4 mr-2 flex-shrink-0 relative z-10">
          {isFolder && hasChildren && (
            <svg
              className="w-4 h-4 text-slate-400"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              viewBox="0 0 24 24"
            >
              {isExpanded ? (
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              )}
            </svg>
          )}
        </div>

        {/* File/folder icon */}
        {isFolder ? (
          <svg className="w-4 h-4 mr-2 text-slate-400 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
          </svg>
        ) : (
          <svg className="w-4 h-4 mr-2 text-slate-400 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
          </svg>
        )}

        <span className="text-slate-200 truncate">{node.name}</span>
      </div>
      {isFolder && isExpanded && hasChildren && (
        <div>
          {node.children!.map((child) => (
            <TreeNodeComponent key={child.id} node={child} level={level + 1} onNodeClick={onNodeClick} onNodeContextMenu={onNodeContextMenu} />
          ))}
        </div>
      )}
    </div>
  )
}

interface TreeViewProps {
  data: TreeNode[]
  onNodeClick?: (node: TreeNode) => void
  onNodeContextMenu?: (node: TreeNode, e: React.MouseEvent) => void
  className?: string
}

export default function TreeView({ data, onNodeClick, onNodeContextMenu, className = '' }: TreeViewProps) {
  return (
    <div className={`text-slate-300 relative isolate ${className}`}>
      {data.map((node) => (
        <TreeNodeComponent key={node.id} node={node} level={0} onNodeClick={onNodeClick} onNodeContextMenu={onNodeContextMenu} />
      ))}
    </div>
  )
}
