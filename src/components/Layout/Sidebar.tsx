import DirectoryTree from './DirectoryTree'
import { useResizable } from '../../hooks/useResizable'
import { LAYOUT } from '../../config/constants'
import type { TreeNode } from '../FileTree/FileTreeView'

interface SidebarProps {
  isOpen: boolean
  selectedFilter: string
  onFilterChange: (filter: string) => void
  onTreeDataChange?: (treeData: TreeNode[]) => void
}

function Sidebar({ isOpen, selectedFilter, onFilterChange, onTreeDataChange }: SidebarProps) {
  const { width, startResizing } = useResizable(
    LAYOUT.SIDEBAR_INITIAL_WIDTH,
    LAYOUT.SIDEBAR_MIN_WIDTH,
    LAYOUT.SIDEBAR_MAX_WIDTH
  )


  if (!isOpen) return null

  return (
    <div
      className="bg-slate-800 border-r border-slate-700 relative flex flex-col h-full"
      style={{ width: `${width}px` }}
    >
      <div className="flex-1 overflow-y-auto overflow-x-hidden px-2 py-2">
        <DirectoryTree selectedFilter={selectedFilter} onFilterChange={onFilterChange} onTreeDataChange={onTreeDataChange} />
      </div>
      <div
        className="absolute top-0 right-0 bottom-0 w-1 opacity-0 cursor-col-resize hover:bg-blue-500 hover:opacity-100 transition-all"
        onMouseDown={startResizing}
      />
    </div>
  )
}

export default Sidebar
