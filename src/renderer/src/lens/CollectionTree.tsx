import { useState } from 'react'
import clsx from 'clsx'
import type { NavNode } from './types'

/**
 * Recursive structural tree (zotero/eagle collections or obsidian folders).
 * Expansion is local UI state: roots open, deeper levels collapsed until clicked.
 * Selection lives in the parent (NavRail owns the LensSelection); this fires
 * `onSelectNode` and reflects the selected ids via `selectedIds` (multi-select).
 */
export function CollectionTree({
  nodes,
  selectedIds,
  onSelectNode,
  depth = 0,
}: {
  nodes: NavNode[]
  selectedIds: (number | string)[]
  onSelectNode: (node: NavNode) => void
  depth?: number
}) {
  return (
    <ul className="flex flex-col">
      {nodes.map((node) => (
        <TreeRow
          key={String(node.id)}
          node={node}
          selectedIds={selectedIds}
          onSelectNode={onSelectNode}
          depth={depth}
        />
      ))}
    </ul>
  )
}

function TreeRow({
  node,
  selectedIds,
  onSelectNode,
  depth,
}: {
  node: NavNode
  selectedIds: (number | string)[]
  onSelectNode: (node: NavNode) => void
  depth: number
}) {
  // Roots (depth 0) expanded; deeper levels collapsed until opened.
  const [open, setOpen] = useState(depth === 0)
  const hasChildren = node.children.length > 0
  const selected = selectedIds.includes(node.id)

  return (
    <li>
      <div className="flex items-center gap-0.5" style={{ paddingLeft: `${depth * 0.75}rem` }}>
        {hasChildren ? (
          <button
            aria-label={`${open ? 'collapse' : 'expand'} ${node.name}`}
            onClick={() => setOpen((o) => !o)}
            className="w-4 shrink-0 text-zinc-500 hover:text-zinc-300"
          >
            {open ? '▾' : '▸'}
          </button>
        ) : (
          <span className="w-4 shrink-0" />
        )}
        <button
          aria-pressed={selected}
          onClick={() => onSelectNode(node)}
          className={clsx(
            'flex min-w-0 flex-1 items-center gap-1.5 rounded px-1.5 py-0.5 text-left text-xs',
            selected ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-400 hover:bg-zinc-800',
          )}
        >
          <span className="truncate">{node.name}</span>
          <span className="ml-auto shrink-0 text-[10px] text-zinc-500">{node.count}</span>
        </button>
      </div>
      {hasChildren && open && (
        <CollectionTree
          nodes={node.children}
          selectedIds={selectedIds}
          onSelectNode={onSelectNode}
          depth={depth + 1}
        />
      )}
    </li>
  )
}
