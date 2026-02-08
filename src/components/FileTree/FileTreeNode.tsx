import { type TreeNode } from './FileTreeView'
import { FilledDocumentIcon, OutlinedDocumentIcon, DatabaseBadge, LinkBadge, FolderIconLarge } from '../icons/FileIcons'

interface FileTreeNodeProps {
  node: TreeNode
  level: number
  parentFolderId: number
  onNodeClick?: (node: TreeNode) => void
  onNodeDoubleClick?: (node: TreeNode) => void
  onNodeContextMenu?: (node: TreeNode, parentFolderId: number, e: React.MouseEvent) => void
  onToggleExpand?: (nodeId: string) => void
  expandedNodes?: Set<string>
}

export default function FileTreeNode({ node, level, parentFolderId, onNodeClick, onNodeDoubleClick, onNodeContextMenu, onToggleExpand, expandedNodes }: FileTreeNodeProps) {
  const isFolder = node.type === 'folder'
  const hasChildren = node.children && node.children.length > 0
  // If expandedNodes is provided (from modal), use it. Otherwise use node.isExpanded (from database)
  const isExpanded = node.isSystemRoot ? true : (expandedNodes ? expandedNodes.has(node.id) : (node.isExpanded || false))

  // Determine the current folder ID (for context menu)
  const currentFolderId = isFolder ? parseInt(node.id.replace('folder-', '')) : parentFolderId

  const handleClick = () => {
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
    onNodeContextMenu?.(node, currentFolderId, e)
  }

  return (
    <div className="relative group">
      <div
        className={`flex items-center py-1.5 cursor-pointer text-sm relative rounded ${
          node.isSystemRoot
            ? 'bg-green-700/20 border border-green-600/30 hover:bg-green-700/30 text-green-300 mx-1 px-2'
            : 'hover:bg-slate-700/50'
        }`}
        style={{ paddingLeft: node.isSystemRoot ? undefined : `${level * 20 + 44}px` }}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onContextMenu={handleContextMenu}
      >
        {/* Vertical lines for parent levels */}
        {!node.isSystemRoot && Array.from({ length: level }).map((_, i) => (
          <div
            key={i}
            className="absolute top-0 bottom-0 w-px bg-slate-600"
            style={{ left: `${i * 20 + 44 + 8}px` }}
          />
        ))}

        {/* Left-aligned action buttons (plus and 6-dot) */}
        {!node.isSystemRoot && (
          <div className="absolute left-0 flex items-center gap-1 px-1 opacity-0 group-hover:opacity-100 transition-opacity">
            {/* Plus button */}
            <button
              className="w-4 h-4 flex items-center justify-center text-slate-400 hover:text-white hover:bg-slate-700/50 hover:border-slate-600 border border-transparent rounded transition-all"
              onClick={(e) => {
                e.stopPropagation()
                // Add handler for add action
              }}
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 16 16">
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 3v10M3 8h10" />
              </svg>
            </button>
            {/* 6-dot button */}
            <button
              className="w-4 h-4 flex items-center justify-center text-slate-400 hover:text-white hover:bg-slate-700/50 hover:border-slate-600 border border-transparent rounded transition-all"
              onClick={(e) => {
                e.stopPropagation()
                // Add handler for drag/reorder
              }}
            >
              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 12 16">
                <circle cx="3" cy="3" r="1.5" />
                <circle cx="9" cy="3" r="1.5" />
                <circle cx="3" cy="8" r="1.5" />
                <circle cx="9" cy="8" r="1.5" />
                <circle cx="3" cy="13" r="1.5" />
                <circle cx="9" cy="13" r="1.5" />
              </svg>
            </button>
          </div>
        )}

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
            <FileTreeNode key={child.id} node={child} level={level + 1} parentFolderId={currentFolderId} onNodeClick={onNodeClick} onNodeDoubleClick={onNodeDoubleClick} onNodeContextMenu={onNodeContextMenu} onToggleExpand={onToggleExpand} expandedNodes={expandedNodes} />
          ))}
        </div>
      )}
    </div>
  )
}
