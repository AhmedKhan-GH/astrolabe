import { useState } from 'react'
import Header from '../Layout/Header'
import Sidebar from '../Layout/Sidebar'
import Workspace from '../Layout/Workspace'
import RightSidebar from '../Layout/RightSidebar'
import type { TreeNode } from '../FileTree/FileTreeView'

function App() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(true)
  const [isRightSidebarOpen, setIsRightSidebarOpen] = useState(true)
  const [selectedFilter, setSelectedFilter] = useState<string>('all')
  const [treeData, setTreeData] = useState<TreeNode[]>([])

  return (
    <div className="h-screen bg-slate-900 flex flex-col">
      <Header
        onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
        onToggleRightSidebar={() => setIsRightSidebarOpen(!isRightSidebarOpen)}
      />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar isOpen={isSidebarOpen} selectedFilter={selectedFilter} onFilterChange={setSelectedFilter} onTreeDataChange={setTreeData} />
        <Workspace selectedFilter={selectedFilter} treeData={treeData} />
        <RightSidebar isOpen={isRightSidebarOpen} />
      </div>
    </div>
  )
}

export default App
