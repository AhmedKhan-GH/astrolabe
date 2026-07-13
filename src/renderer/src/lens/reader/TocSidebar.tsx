import { useMemo, useState } from 'react'
import clsx from 'clsx'
import type { OutlineEntry, TocRange } from './toc'

/** Levels shown open on first paint (depth 1 + 2); deeper nodes start collapsed. */
const DEFAULT_EXPAND_DEPTH = 2

/**
 * The Reader's table-of-contents sidebar (docs/2026-07-13-r3-structure-views-spec §4, R3a): an
 * indented, collapsible outline tree. A row click navigates to the start of that section's page
 * range; a per-row checkbox drives multi-select (feeds R3b's "save as View", lifted to
 * ReaderView); the section containing the current page is highlighted live via `currentPath`.
 * Expansion is owned internally — parents track manual expand/collapse as overrides on top of a
 * derived default, so no prop→state effect is needed (react-compiler clean).
 */
export function TocSidebar({
  outline,
  ranges,
  currentPath,
  selected,
  onToggleSelect,
  onNavigate,
}: {
  outline: OutlineEntry[] | null
  ranges: Map<string, TocRange>
  /** The deepest section containing the current page, highlighted; null when outside all. */
  currentPath: string | null
  selected: ReadonlySet<string>
  onToggleSelect: (path: string) => void
  /** Navigate the Reader to a 0-based page (a section's start). */
  onNavigate: (pageIndex: number) => void
}) {
  // Nodes with children shallower than DEFAULT_EXPAND_DEPTH start open (derived, not stored).
  const defaultExpanded = useMemo(() => {
    const set = new Set<string>()
    const walk = (items: OutlineEntry[], parentPath: string, level: number): void => {
      items.forEach((item, i) => {
        const path = `${parentPath}/${i}`
        if (item.children.length > 0) {
          if (level < DEFAULT_EXPAND_DEPTH) set.add(path)
          walk(item.children, path, level + 1)
        }
      })
    }
    walk(outline ?? [], '', 1)
    return set
  }, [outline])

  // User toggles as overrides so expansion never needs to be synced from props in an effect.
  const [expandedOverride, setExpandedOverride] = useState<ReadonlySet<string>>(new Set())
  const [collapsedOverride, setCollapsedOverride] = useState<ReadonlySet<string>>(new Set())
  const isExpanded = (path: string): boolean =>
    collapsedOverride.has(path) ? false : expandedOverride.has(path) || defaultExpanded.has(path)
  const toggleExpand = (path: string): void => {
    const open = isExpanded(path)
    setExpandedOverride((prev) => {
      const next = new Set(prev)
      if (open) next.delete(path)
      else next.add(path)
      return next
    })
    setCollapsedOverride((prev) => {
      const next = new Set(prev)
      if (open) next.add(path)
      else next.delete(path)
      return next
    })
  }

  const renderNodes = (items: OutlineEntry[], parentPath: string, level: number): React.ReactNode => (
    <ul className={level === 1 ? '' : 'ml-0'}>
      {items.map((item, i) => {
        const path = `${parentPath}/${i}`
        const hasChildren = item.children.length > 0
        const expanded = isExpanded(path)
        const range = ranges.get(path)
        const isCurrent = path === currentPath
        return (
          <li key={path}>
            <div
              className={clsx(
                'flex items-center gap-1 rounded pr-1 text-sm',
                isCurrent ? 'bg-amber-950/60' : 'hover:bg-zinc-900',
              )}
              style={{ paddingLeft: `${(level - 1) * 14}px` }}
            >
              <input
                type="checkbox"
                aria-label={`select ${item.title}`}
                checked={selected.has(path)}
                onChange={() => onToggleSelect(path)}
                onClick={(e) => e.stopPropagation()}
                className="shrink-0 accent-amber-500"
              />
              {hasChildren ? (
                <button
                  type="button"
                  aria-label={`${expanded ? 'collapse' : 'expand'} ${item.title}`}
                  onClick={() => toggleExpand(path)}
                  className="shrink-0 px-1 text-xs text-zinc-500 hover:text-zinc-300"
                >
                  {expanded ? '▾' : '▸'}
                </button>
              ) : (
                <span className="inline-block w-4 shrink-0" />
              )}
              <button
                type="button"
                aria-current={isCurrent ? 'location' : undefined}
                onClick={() => range && onNavigate(range.start)}
                className={clsx(
                  'min-w-0 flex-1 truncate py-1 text-left',
                  isCurrent ? 'text-amber-200' : 'text-zinc-300',
                )}
                title={item.title}
              >
                {item.title}
              </button>
            </div>
            {hasChildren && expanded && renderNodes(item.children, path, level + 1)}
          </li>
        )
      })}
    </ul>
  )

  return (
    <nav
      aria-label="table of contents"
      className="w-64 shrink-0 overflow-y-auto border-r border-zinc-800 bg-zinc-950 p-2"
    >
      {outline && outline.length > 0 ? (
        renderNodes(outline, '', 1)
      ) : (
        <p className="px-2 py-1 text-xs text-zinc-600">No outline</p>
      )}
    </nav>
  )
}
