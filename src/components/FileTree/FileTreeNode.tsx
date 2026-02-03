import { type TreeNode } from './FileTreeView'
import { FilledDocumentIcon, OutlinedDocumentIcon, DatabaseBadge, LinkBadge, FolderIconLarge } from '../icons/FileIcons'

interface FileTreeNodeProps {
  node: TreeNode
  level: number
  onNodeClick?: (node: TreeNode) => void
  onNodeDoubleClick?: (node: TreeNode) => void
  onNodeContextMenu?: (node: TreeNode, e: React.MouseEvent) => void
  onToggleExpand?: (nodeId: string) => void
  expandedNodes?: Set<string>
}

export default function FileTreeNode({ node, level, onNodeClick, onNodeDoubleClick, onNodeContextMenu, onToggleExpand, expandedNodes }: FileTreeNodeProps) {
  const isFolder = node.type === 'folder'
  const hasChildren = node.children && node.children.length > 0
  // If expandedNodes is provided (from modal), use it. Otherwise use node.isExpanded (from database)
  const isExpanded = node.isSystemRoot ? true : (expandedNodes ? expandedNodes.has(node.id) : (node.isExpanded || false))

  const handleClick = () => {
    if (isFolder && !node.isSystemRoot) {
      onToggleExpand?.(node.id)
    }
    onNodeClick?.(node)
  }

  const handleDoubleClick = () => {
    onNodeDoubleClick?.(node)
  }

  const handleChevronClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (isFolder && hasChildren) {
      onToggleExpand?.(node.id)
    }
  }

  const handleContextMenu = (e: React.MouseEvent) => {
    onNodeContextMenu?.(node, e)
  }

  return (
    <div className="relative">
      <div
        className={`flex items-center py-1.5 cursor-pointer text-sm relative rounded ${
          node.isSystemRoot
            ? 'bg-green-700/20 border border-green-600/30 hover:bg-green-700/30 text-green-300 mx-1 px-2'
            : 'hover:bg-slate-700/50'
        }`}
        style={{ paddingLeft: node.isSystemRoot ? undefined : `${level * 20 + 14}px` }}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onContextMenu={handleContextMenu}
      >
        {/* Vertical lines for parent levels */}
        {!node.isSystemRoot && Array.from({ length: level }).map((_, i) => (
          <div
            key={i}
            className="absolute top-0 bottom-0 w-px bg-slate-600"
            style={{ left: `${i * 20 + 14 + 8}px` }}
          />
        ))}

        {/* Expand/collapse chevron */}
        {!node.isSystemRoot && (
          <div className="w-4 mr-2 flex-shrink-0 relative z-10" onClick={handleChevronClick}>
            {isFolder && hasChildren && (
              <svg
                className="w-4 h-4 text-slate-400 border border-transparent hover:border-slate-600 hover:bg-slate-700/50 hover:text-white rounded transition-all"
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
        )}

        {/* File/folder icon */}
        {isFolder ? (
          <div className="mr-2 flex-shrink-0">
            {node.isSystemRoot ? (
              <svg className="w-4 h-4 text-green-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
              </svg>
            ) : (
              <FolderIconLarge />
            )}
          </div>
        ) : (
          <div className="relative mr-2 flex-shrink-0">
            {node.storageType === 'import' ? (
              // Imported file: filled document with database badge
              <>
                <FilledDocumentIcon />
                <div className="absolute -bottom-0.5 -right-0.5 bg-slate-800 rounded-full p-px">
                  <DatabaseBadge />
                </div>
              </>
            ) : (
              // Referenced file: outlined document with link badge
              <>
                <OutlinedDocumentIcon />
                <div className="absolute -bottom-0.5 -right-0.5 bg-slate-800 rounded-full p-px">
                  <LinkBadge />
                </div>
              </>
            )}
          </div>
        )}

        <span className="text-slate-200 truncate">{node.name}</span>
      </div>
      {isFolder && isExpanded && hasChildren && (
        <div>
          {node.children!.map((child) => (
            <FileTreeNode key={child.id} node={child} level={level + 1} onNodeClick={onNodeClick} onNodeDoubleClick={onNodeDoubleClick} onNodeContextMenu={onNodeContextMenu} onToggleExpand={onToggleExpand} expandedNodes={expandedNodes} />
          ))}
        </div>
      )}
    </div>
  )
}
