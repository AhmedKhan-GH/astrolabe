import { useState, useEffect } from 'react'
import DatabasePickerModal from '../FileTree/DatabasePickerModal'

interface HeaderProps {
  onToggleSidebar: () => void
}

function Header({ onToggleSidebar }: HeaderProps) {
  const [showDatabasePicker, setShowDatabasePicker] = useState(false)
  const [currentDatabase, setCurrentDatabase] = useState<string | null>(null)
  const [defaultDatabase, setDefaultDatabase] = useState<string | null>(null)

  useEffect(() => {
    const loadCurrentDatabase = async () => {
      const current = await window.electron.getCurrentDatabase()
      const defaultPath = await window.electron.getDefaultDatabasePath()
      setCurrentDatabase(current)
      setDefaultDatabase(defaultPath)
    }
    loadCurrentDatabase()
  }, [])

  const handleDatabaseSelect = async (dbPath: string) => {
    console.log('Selected database:', dbPath)
    setShowDatabasePicker(false)
    // Database has been reinitialized on the backend, reload to refresh UI
    window.location.reload()
  }

  const getDatabaseName = (dbPath: string | null) => {
    if (!dbPath) return 'Database'
    // Extract filename from path (works cross-platform)
    const name = dbPath.split(/[\\/]/).pop() || 'Database'
    // If it's the system default, show "System Default"
    if (name === 'data' || dbPath === defaultDatabase) return 'System Default'
    return name
  }

  const isSystemDefault = () => {
    if (!currentDatabase || !defaultDatabase) return false
    const currentName = currentDatabase.split(/[\\/]/).pop()
    return currentName === 'data' || currentDatabase === defaultDatabase
  }

  return (
    <>
      <div className="flex items-center justify-between gap-2 p-2 bg-slate-800 border-b border-slate-700">
        <div className="flex gap-2">
          <button
            onClick={onToggleSidebar}
            className="flex items-center gap-1 px-3 py-1 rounded border border-slate-600 text-slate-300 hover:bg-slate-700/50 hover:text-white transition-colors"
            title="Toggle sidebar"
          >
            <svg
              className="w-4 h-4"
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
          className={`flex items-center gap-2 px-3 py-1 rounded border max-w-[150px] transition-colors ${
            isSystemDefault()
              ? 'border-green-600/50 bg-green-700/20 text-green-300 hover:bg-green-700/30'
              : 'border-slate-600 text-slate-300 hover:bg-slate-700/50 hover:text-white'
          }`}
          title={currentDatabase ? `Current database: ${currentDatabase}` : "Select or create database"}
        >
          <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
          </svg>
          <span className="text-sm truncate">{getDatabaseName(currentDatabase)}</span>
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
