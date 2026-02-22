import { useState, useRef, useEffect } from 'react'
import { type TreeNode } from './FileTreeView'
import { FilledDocumentIcon, OutlinedDocumentIcon, DatabaseBadge, LinkBadge, FolderIconLarge } from '../icons/FileIcons'
import FolderPickerModal from './FolderPickerModal'
import type { Folder, File } from '../../db/schema'

interface FileTreeNodeProps {
  node: TreeNode
  level: number
  parentFolderId: number
  onNodeClick?: (node: TreeNode) => void
  onNodeDoubleClick?: (node: TreeNode) => void
  onNodeContextMenu?: (node: TreeNode, parentFolderId: number, e: React.MouseEvent) => void
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

export default function FileTreeNode({ node, level, parentFolderId, onNodeClick, onNodeDoubleClick, onNodeContextMenu, onToggleExpand, expandedNodes, hideActionButtons = false, highlightedNodeId, onAddFolder, onAddFile, onReferenceFile, onExpandAll, onCollapseAll, onMoveTo, allFolders = [], allFiles = [] }: FileTreeNodeProps) {
  const [showPlusMenu, setShowPlusMenu] = useState(false)
  const [showDotMenu, setShowDotMenu] = useState(false)
  const [showMovePickerFromDot, setShowMovePickerFromDot] = useState(false)
  const [plusMenuPosition, setPlusMenuPosition] = useState({ x: 0, y: 0 })
  const [dotMenuPosition, setDotMenuPosition] = useState({ x: 0, y: 0 })
  const plusMenuRef = useRef<HTMLDivElement>(null)
  const plusButtonRef = useRef<HTMLButtonElement>(null)
  const dotMenuRef = useRef<HTMLDivElement>(null)
  const dotButtonRef = useRef<HTMLButtonElement>(null)
  const isFolder = node.type === 'folder'
  const hasChildren = node.children && node.children.length > 0
  // If expandedNodes is provided (from modal), use it. Otherwise use node.isExpanded (from database)
  const isExpanded = node.isSystemRoot ? true : (expandedNodes ? expandedNodes.has(node.id) : (node.isExpanded || false))
  const isHighlighted = highlightedNodeId === node.id

  // Determine the current folder ID (for context menu)
  const currentFolderId = isFolder ? parseInt(node.id.replace('folder-', '')) : parentFolderId

  // Close menus when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (showPlusMenu &&
          plusMenuRef.current &&
          plusButtonRef.current &&
          !plusMenuRef.current.contains(event.target as Node) &&
          !plusButtonRef.current.contains(event.target as Node)) {
        setShowPlusMenu(false)
      }
      if (showDotMenu &&
          dotMenuRef.current &&
          dotButtonRef.current &&
          !dotMenuRef.current.contains(event.target as Node) &&
          !dotButtonRef.current.contains(event.target as Node)) {
        setShowDotMenu(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showPlusMenu, showDotMenu])

  const handleClick = () => {
    if (node.isDisabled) return
    setShowPlusMenu(false)
    setShowDotMenu(false)
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
    setShowPlusMenu(false)
    setShowDotMenu(false)
    onNodeContextMenu?.(node, currentFolderId, e)
  }

  return (
    <div className="relative">
      {/* Vertical lines for parent levels - outside opacity container */}
      {!node.isSystemRoot && Array.from({ length: level }).map((_, i) => (
        <div
          key={i}
          className="absolute top-0 bottom-0 w-px bg-slate-600"
          style={{ left: `${i * 20 + (hideActionButtons ? 0 : 44) + 8}px` }}
        />
      ))}


      <div
        className={`flex items-center py-1.5 text-sm relative rounded group ${
          node.isDisabled
            ? 'opacity-40 cursor-not-allowed'
            : node.isSystemRoot
            ? 'bg-green-700/20 border border-green-600/30 hover:bg-green-700/30 text-green-300 mx-1 px-2 cursor-pointer'
            : 'hover:bg-slate-700/50 cursor-pointer'
        }`}
        style={{ paddingLeft: node.isSystemRoot ? undefined : `${level * 20 + (hideActionButtons ? 0 : 44)}px` }}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onContextMenu={handleContextMenu}
      >

        {/* Left-aligned action buttons (plus and 6-dot) */}
        {!node.isSystemRoot && !hideActionButtons && (
          <div className="absolute left-0 flex items-center gap-1 px-1 opacity-0 group-hover:opacity-100 transition-opacity z-20">
            {/* Plus button with dropdown for folders */}
            {isFolder && (
              <div className="relative">
                <button
                  ref={plusButtonRef}
                  className="w-4 h-4 flex items-center justify-center text-slate-400 hover:text-white hover:bg-slate-700/50 hover:border-slate-600 border border-transparent rounded transition-all"
                  onClick={(e) => {
                    e.stopPropagation()
                    if (!showPlusMenu && plusButtonRef.current) {
                      const rect = plusButtonRef.current.getBoundingClientRect()
                      setPlusMenuPosition({ x: rect.left, y: rect.bottom + 2 })
                    }
                    setShowPlusMenu(!showPlusMenu)
                  }}
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 16 16">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 3v10M3 8h10" />
                  </svg>
                </button>

                {/* Plus button dropdown menu */}
                {showPlusMenu && (
                  <div
                    ref={plusMenuRef}
                    className="fixed bg-slate-700 border border-slate-600 rounded shadow-lg py-1 z-[9999] w-[140px]"
                    style={{ left: `${plusMenuPosition.x}px`, top: `${plusMenuPosition.y}px` }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {onAddFolder && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          onAddFolder(currentFolderId)
                          setShowPlusMenu(false)
                        }}
                        className="w-full text-left px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-600"
                      >
                        New Folder
                      </button>
                    )}
                    {onAddFile && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          onAddFile(currentFolderId)
                          setShowPlusMenu(false)
                        }}
                        className="w-full text-left px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-600"
                      >
                        Import File
                      </button>
                    )}
                    {onReferenceFile && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          onReferenceFile(currentFolderId)
                          setShowPlusMenu(false)
                        }}
                        className="w-full text-left px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-600"
                      >
                        Reference File
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
            {/* 6-dot button with dropdown for folders */}
            {isFolder && (
              <div className="relative">
                <button
                  ref={dotButtonRef}
                  className="w-4 h-4 flex items-center justify-center text-slate-400 hover:text-white hover:bg-slate-700/50 hover:border-slate-600 border border-transparent rounded transition-all"
                  onClick={(e) => {
                    e.stopPropagation()
                    if (!showDotMenu && dotButtonRef.current) {
                      const rect = dotButtonRef.current.getBoundingClientRect()
                      setDotMenuPosition({ x: rect.left, y: rect.bottom + 2 })
                    }
                    setShowDotMenu(!showDotMenu)
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

                {/* 6-dot button dropdown menu */}
                {showDotMenu && (
                  <div
                    ref={dotMenuRef}
                    className="fixed bg-slate-700 border border-slate-600 rounded shadow-lg py-1 z-[9999] w-[140px]"
                    style={{ left: `${dotMenuPosition.x}px`, top: `${dotMenuPosition.y}px` }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {onMoveTo && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          setShowMovePickerFromDot(true)
                          setShowDotMenu(false)
                        }}
                        className="w-full text-left px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-600"
                      >
                        Move to
                      </button>
                    )}
                    {onExpandAll && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          onExpandAll(currentFolderId)
                          setShowDotMenu(false)
                        }}
                        className="w-full text-left px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-600"
                      >
                        Expand All
                      </button>
                    )}
                    {onCollapseAll && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          onCollapseAll(currentFolderId)
                          setShowDotMenu(false)
                        }}
                        className="w-full text-left px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-600"
                      >
                        Collapse All
                      </button>
                    )}
                    {onAddFolder && (
                      <>
                        <div className="h-px bg-slate-600 my-1" />
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            onAddFolder(currentFolderId)
                            setShowDotMenu(false)
                          }}
                          className="w-full text-left px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-600"
                        >
                          New Folder
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}
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
          <div className={`mr-2 flex-shrink-0 ${isHighlighted ? 'ring-2 ring-blue-500 rounded' : ''}`}>
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

        {/* Filename with extension - extension always visible on right */}
        {!isFolder && node.name.includes('.') ? (
          <div className="flex items-center justify-between min-w-0 flex-1">
            <span className="text-slate-200 truncate">{node.name.substring(0, node.name.lastIndexOf('.'))}</span>
            <span className="text-slate-400 flex-shrink-0 ml-1">{node.name.substring(node.name.lastIndexOf('.'))}</span>
          </div>
        ) : (
          <span className="text-slate-200 truncate">{node.name}</span>
        )}
      </div>
      {isFolder && isExpanded && hasChildren && (
        <div>
          {node.children!.map((child) => (
            <FileTreeNode key={child.id} node={child} level={level + 1} parentFolderId={currentFolderId} onNodeClick={onNodeClick} onNodeDoubleClick={onNodeDoubleClick} onNodeContextMenu={onNodeContextMenu} onToggleExpand={onToggleExpand} expandedNodes={expandedNodes} hideActionButtons={hideActionButtons} highlightedNodeId={highlightedNodeId} onAddFolder={onAddFolder} onAddFile={onAddFile} onReferenceFile={onReferenceFile} onExpandAll={onExpandAll} onCollapseAll={onCollapseAll} onMoveTo={onMoveTo} allFolders={allFolders} allFiles={allFiles} />
          ))}
        </div>
      )}

      {/* Folder picker modal for Move to from 6-dot menu */}
      {showMovePickerFromDot && isFolder && onMoveTo && (
        <FolderPickerModal
          allFolders={allFolders}
          currentFolderId={currentFolderId}
          greyedOutFolderIds={(() => {
            const folderId = currentFolderId
            const descendants = getAllDescendantIds(folderId, allFolders)
            const folder = allFolders.find(f => f.id === folderId)
            const greyedOut = [folderId, ...descendants]
            if (folder?.parentId !== undefined) {
              greyedOut.push(folder.parentId)
            }
            return greyedOut
          })()}
          onSelect={(folderId) => {
            onMoveTo(folderId)
            setShowMovePickerFromDot(false)
          }}
          onClose={() => setShowMovePickerFromDot(false)}
        />
      )}
    </div>
  )
}

// Helper function to get all descendant IDs
function getAllDescendantIds(folderId: number, allFolders: Folder[] = []): number[] {
  const descendants: number[] = []
  const children = allFolders.filter(f => f.parentId === folderId)
  children.forEach(child => {
    descendants.push(child.id)
    descendants.push(...getAllDescendantIds(child.id, allFolders))
  })
  return descendants
}
