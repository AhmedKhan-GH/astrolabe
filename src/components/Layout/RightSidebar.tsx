import { useState, useEffect } from 'react'
import { LAYOUT } from '../../config/constants'

interface RightSidebarProps {
  isOpen: boolean
}

function RightSidebar({ isOpen }: RightSidebarProps) {
  const [width, setWidth] = useState(300)
  const [isResizing, setIsResizing] = useState(false)
  const minWidth = LAYOUT.SIDEBAR_MIN_WIDTH
  const maxWidth = LAYOUT.SIDEBAR_MAX_WIDTH

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return
      // For right sidebar, width = window width - mouse X position
      const newWidth = window.innerWidth - e.clientX
      if (newWidth >= minWidth && newWidth <= maxWidth) {
        setWidth(newWidth)
      }
    }

    const handleMouseUp = () => {
      setIsResizing(false)
    }

    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isResizing])

  if (!isOpen) return null

  return (
    <div
      className="bg-slate-800 border-l border-slate-700 relative flex flex-col h-full"
      style={{ width: `${width}px` }}
    >
      <div className="flex-1 overflow-y-auto overflow-x-hidden px-4 py-4">
        <h3 className="text-slate-400 text-sm font-semibold mb-2">Details</h3>
        <p className="text-slate-500 text-sm">Placeholder for file details</p>
      </div>
      <div
        className="absolute top-0 left-0 bottom-0 w-1 opacity-0 cursor-col-resize hover:bg-blue-500 hover:opacity-100 transition-all"
        onMouseDown={() => setIsResizing(true)}
      />
    </div>
  )
}

export default RightSidebar
