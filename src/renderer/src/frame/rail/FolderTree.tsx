import type { FolderTreeNode } from '../../../../main/index/queries'
import type { RailSelection } from '../state'
import { rowClass } from './ui'

/**
 * The folder tree (frame spec §2). Each row: expand chevron (only when it has
 * children), name, own count, and — on parents — the subtree count dimmed
 * beside it. The selected folder row grows a subtree toggle that flips
 * includeSubfolders. Right-click anywhere on a row raises the context menu.
 * Expand/collapse is in-session state owned by Rail.
 */
export function FolderTree({
  nodes,
  depth,
  rail,
  expanded,
  onToggleExpand,
  onSelect,
  onToggleSubfolders,
  onContextMenu,
}: {
  nodes: FolderTreeNode[]
  depth: number
  rail: RailSelection
  expanded: Set<string>
  onToggleExpand: (slug: string) => void
  onSelect: (slug: string) => void
  onToggleSubfolders: (slug: string) => void
  onContextMenu: (e: React.MouseEvent, node: FolderTreeNode) => void
}): React.JSX.Element {
  return (
    <>
      {nodes.map((node) => {
        const hasChildren = node.children.length > 0
        const isOpen = expanded.has(node.slug)
        const active = rail.kind === 'folder' && rail.slug === node.slug
        return (
          <div key={node.slug}>
            <div
              className={rowClass(active)}
              style={{ paddingLeft: depth * 12 + 8 }}
              onContextMenu={(e) => onContextMenu(e, node)}
            >
              {hasChildren ? (
                <button
                  type="button"
                  aria-label={isOpen ? `Collapse ${node.name}` : `Expand ${node.name}`}
                  onClick={() => onToggleExpand(node.slug)}
                  className="w-4 shrink-0 text-neutral-500 hover:text-neutral-300"
                >
                  {isOpen ? '▾' : '▸'}
                </button>
              ) : (
                <span className="w-4 shrink-0" />
              )}
              <button type="button" onClick={() => onSelect(node.slug)} className="flex-1 truncate">
                {node.name}
              </button>
              <span className="shrink-0 text-xs text-neutral-500">{node.ownCount}</span>
              {hasChildren && (
                <span
                  className="shrink-0 text-xs text-neutral-600"
                  title={`${node.subtreeCount} in subtree`}
                >
                  {node.subtreeCount}
                </span>
              )}
              {active && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    onToggleSubfolders(node.slug)
                  }}
                  aria-label="Toggle include subfolders"
                  title={
                    rail.kind === 'folder' && rail.includeSubfolders
                      ? 'Including subfolders — click for this folder only'
                      : 'This folder only — click to include subfolders'
                  }
                  className={`shrink-0 rounded px-1 text-xs ${
                    rail.kind === 'folder' && rail.includeSubfolders
                      ? 'text-violet-300'
                      : 'text-neutral-600 hover:text-neutral-400'
                  }`}
                >
                  ⊂
                </button>
              )}
            </div>
            {hasChildren && isOpen && (
              <FolderTree
                nodes={node.children}
                depth={depth + 1}
                rail={rail}
                expanded={expanded}
                onToggleExpand={onToggleExpand}
                onSelect={onSelect}
                onToggleSubfolders={onToggleSubfolders}
                onContextMenu={onContextMenu}
              />
            )}
          </div>
        )
      })}
    </>
  )
}
