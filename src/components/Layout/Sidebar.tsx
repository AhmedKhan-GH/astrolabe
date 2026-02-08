import DirectoryTree from './DirectoryTree'
import { useResizable } from '../../hooks/useResizable'

interface SidebarProps {
  isOpen: boolean
}

function Sidebar({ isOpen }: SidebarProps) {
  const { width, startResizing } = useResizable(250, 150, 600)


  if (!isOpen) return null

  return (
    <div
      className="bg-slate-800 border-r border-slate-700 flex"
      style={{ width: `${width}px` }}
    >
      <div className="flex-1 overflow-y-auto px-2 py-2">
        <DirectoryTree />
      </div>
      <div
        className="w-1 cursor-col-resize hover:bg-blue-500 transition-colors"
        onMouseDown={startResizing}
      />
    </div>
  )
}

export default Sidebar
