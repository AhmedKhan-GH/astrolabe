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
      className="bg-slate-800 border-r border-slate-700 relative"
      style={{ width: `${width}px` }}
    >
      <div className="overflow-y-auto overflow-x-hidden px-2 py-2">
        <DirectoryTree />
      </div>
      <div
        className="absolute top-0 right-0 bottom-0 w-1 opacity-0 cursor-col-resize hover:bg-blue-500 hover:opacity-100 transition-all"
        onMouseDown={startResizing}
      />
    </div>
  )
}

export default Sidebar
