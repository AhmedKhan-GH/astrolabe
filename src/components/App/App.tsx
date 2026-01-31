import { useState } from 'react'
import Header from '../Layout/Header'
import Sidebar from '../Layout/Sidebar'
import Workspace from '../Layout/Workspace'

function App() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(true)

  return (
    <div className="h-screen bg-slate-900 flex flex-col">
      <Header onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)} />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar isOpen={isSidebarOpen} />
        <Workspace />
      </div>
    </div>
  )
}

export default App
