import { useState, useEffect } from 'react'

interface SidebarProps {
  isOpen: boolean
}

interface TreeNode {
  id: string
  name: string
  type: 'file' | 'folder'
  children?: TreeNode[]
}

interface TreeNodeComponentProps {
  node: TreeNode
  level: number
}

function TreeNodeComponent({ node, level }: TreeNodeComponentProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const isFolder = node.type === 'folder'
  const hasChildren = node.children && node.children.length > 0

  return (
    <div className="relative">
      <div
        className="flex items-center py-1.5 hover:bg-slate-700/50 cursor-pointer text-sm relative"
        style={{ paddingLeft: `${level * 20 + 8}px` }}
        onClick={() => isFolder && setIsExpanded(!isExpanded)}
      >
        {/* Vertical lines for parent levels */}
        {Array.from({ length: level }).map((_, i) => (
          <div
            key={i}
            className="absolute top-0 bottom-0 w-px bg-slate-600"
            style={{ left: `${i * 20 + 8 + 8}px` }}
          />
        ))}

        {/* Expand/collapse chevron */}
        <div className="w-4 mr-2 flex-shrink-0 relative bg-slate-800 z-10">
          {isFolder && hasChildren && (
            <svg
              className="w-4 h-4 text-slate-400"
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

        {/* File/folder icon */}
        {isFolder ? (
          <svg className="w-4 h-4 mr-2 text-slate-400 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
          </svg>
        ) : (
          <svg className="w-4 h-4 mr-2 text-slate-400 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
          </svg>
        )}

        <span className="text-slate-200 truncate">{node.name}</span>
      </div>
      {isFolder && isExpanded && hasChildren && (
        <div>
          {node.children!.map((child) => (
            <TreeNodeComponent key={child.id} node={child} level={level + 1} />
          ))}
        </div>
      )}
    </div>
  )
}

function Sidebar({ isOpen }: SidebarProps) {
  const [width, setWidth] = useState(250)
  const [isResizing, setIsResizing] = useState(false)

  // Sample tree data - replace with your actual data
  const treeData: TreeNode[] = [
    {
      id: '1',
      name: 'src',
      type: 'folder',
      children: [
        {
          id: '2',
          name: 'components',
          type: 'folder',
          children: [
            { id: '3', name: 'Header.tsx', type: 'file' },
            { id: '4', name: 'Footer.tsx', type: 'file' },
          ],
        },
        {
          id: '5',
          name: 'utils',
          type: 'folder',
          children: [
            { id: '6', name: 'helpers.ts', type: 'file' },
          ],
        },
        { id: '7', name: 'App.tsx', type: 'file' },
      ],
    },
    {
      id: '8',
      name: 'public',
      type: 'folder',
      children: [
        { id: '9', name: 'index.html', type: 'file' },
      ],
    },
    { id: '10', name: 'package.json', type: 'file' },
  ]

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
        <h2 className="text-white text-lg font-semibold mb-4">Files</h2>
        <div className="text-slate-300">
          {treeData.map((node) => (
            <TreeNodeComponent key={node.id} node={node} level={0} />
          ))}
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
