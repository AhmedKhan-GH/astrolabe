import { useState } from 'react'
import DatabasePickerModal from '../FileTree/DatabasePickerModal'

interface HeaderProps {
  onToggleSidebar: () => void
}

function Header({ onToggleSidebar }: HeaderProps) {
  const [showDatabasePicker, setShowDatabasePicker] = useState(false)

  const handleDatabaseSelect = async (dbPath: string) => {
    console.log('Selected database:', dbPath)
    setShowDatabasePicker(false)
    // Database has been reinitialized on the backend, reload to refresh UI
    window.location.reload()
  }

  return (
    <>
      <div className="flex items-center justify-between gap-2 p-2 bg-slate-800 border-b border-slate-700">
        <div className="flex gap-2">
          <button
            onClick={onToggleSidebar}
            className="flex items-center gap-1 px-1.5 py-1 rounded border border-slate-600 text-slate-300 hover:bg-slate-700/50 hover:text-white transition-colors"
            title="Toggle sidebar"
          >
            <svg
              className="w-3 h-3"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 6h16M4 12h16M4 18h16"
              />
            </svg>
          </button>
        </div>

        <button
          onClick={() => setShowDatabasePicker(true)}
          className="flex items-center gap-2 px-3 py-1 rounded border border-slate-600 text-slate-300 hover:bg-slate-700/50 hover:text-white transition-colors"
          title="Select or create database"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
          </svg>
          <span className="text-sm">Database</span>
        </button>
      </div>

      {showDatabasePicker && (
        <DatabasePickerModal
          onSelect={handleDatabaseSelect}
          onClose={() => setShowDatabasePicker(false)}
        />
      )}
    </>
  )
}

export default Header
