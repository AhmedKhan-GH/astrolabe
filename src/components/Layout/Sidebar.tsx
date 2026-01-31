import { useState, useEffect } from 'react'

interface SidebarProps {
  isOpen: boolean
}

function Sidebar({ isOpen }: SidebarProps) {
  const [width, setWidth] = useState(250)
  const [isResizing, setIsResizing] = useState(false)

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return
      const newWidth = e.clientX
      if (newWidth >= 150 && newWidth <= 600) {
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
      className="bg-slate-800 border-r border-slate-700 flex"
      style={{ width: `${width}px` }}
    >
      <div className="flex-1 overflow-y-auto p-4">
        <h2 className="text-white text-lg font-semibold mb-4">Sidebar</h2>
        <div className="text-slate-300">
          {/* Add your sidebar content here */}
          <p>Sidebar content goes here</p>
        </div>
      </div>
      <div
        className="w-1 cursor-col-resize hover:bg-blue-500 transition-colors"
        onMouseDown={() => setIsResizing(true)}
      />
    </div>
  )
}

export default Sidebar
