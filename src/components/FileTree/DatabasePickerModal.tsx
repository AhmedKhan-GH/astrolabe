import { useEffect, useState } from 'react'

interface DatabasePickerModalProps {
  onSelect: (dbPath: string) => void
  onClose: () => void
}

export default function DatabasePickerModal({ onSelect, onClose }: DatabasePickerModalProps) {
  const [databases, setDatabases] = useState<string[]>([])
  const [currentDatabase, setCurrentDatabase] = useState<string | null>(null)
  const [deleteConfirmDatabase, setDeleteConfirmDatabase] = useState<string | null>(null)
  const [deleteConfirmInput, setDeleteConfirmInput] = useState('')

  useEffect(() => {
    const loadDatabases = async () => {
      const dbList = await window.electron.getDatabasesList()
      const current = await window.electron.getCurrentDatabase()
      setDatabases(dbList)
      setCurrentDatabase(current)
    }
    loadDatabases()
  }, [])

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [onClose])

  const handleSelectExisting = async () => {
    try {
      const result = await window.electron.selectDatabaseFile()
      if (result) {
        onSelect(result)
      }
    } catch (error) {
      console.error('Failed to select database:', error)
    }
  }

  const handleCreateNew = async () => {
    try {
      const result = await window.electron.createDatabaseFile()
      if (result) {
        onSelect(result)
      }
    } catch (error) {
      console.error('Failed to create database:', error)
    }
  }

  const handleSwitchToDatabase = async (dbPath: string) => {
    try {
      await window.electron.switchToDatabase(dbPath)
      // The IPC handler will reload the window, so onSelect won't be called
    } catch (error) {
      console.error('Failed to switch database:', error)
    }
  }

  const handleSwitchToDefault = async () => {
    try {
      await window.electron.switchToDefaultDatabase()
      // The IPC handler will reload the window
    } catch (error) {
      console.error('Failed to switch to default database:', error)
    }
  }

  const getDatabaseName = (dbPath: string) => {
    // Extract filename from path (works cross-platform)
    return dbPath.split(/[\\/]/).pop() || dbPath
  }

  const handleDeleteDatabase = async (dbPath: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setDeleteConfirmDatabase(dbPath)
    setDeleteConfirmInput('')
  }

  const handleConfirmDelete = async () => {
    if (!deleteConfirmDatabase) return

    const dbName = getDatabaseName(deleteConfirmDatabase)
    if (deleteConfirmInput !== dbName) return

    try {
      await window.electron.deleteDatabase(deleteConfirmDatabase)
      setDeleteConfirmDatabase(null)
      setDeleteConfirmInput('')
      // Reload databases list
      const dbList = await window.electron.getDatabasesList()
      setDatabases(dbList)
    } catch (error) {
      console.error('Failed to delete database:', error)
    }
  }

  const handleCancelDelete = () => {
    setDeleteConfirmDatabase(null)
    setDeleteConfirmInput('')
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={deleteConfirmDatabase ? undefined : onClose}>
      {deleteConfirmDatabase ? (
        <div className="bg-slate-800 border border-red-600 rounded-lg shadow-xl w-[500px] p-6" onClick={(e) => e.stopPropagation()}>
          <h3 className="text-white font-semibold text-lg mb-2">Delete Database</h3>
          <p className="text-slate-300 text-sm mb-4">
            This action <span className="text-red-400 font-semibold">CANNOT be undone</span>.
            {getDatabaseName(deleteConfirmDatabase) === 'data' ? (
              <> This will reset the system default database and delete all its contents.</>
            ) : (
              <> This will permanently delete the database file from your system.</>
            )}
          </p>
          <p className="text-slate-300 text-sm mb-4">
            Type <span className="font-mono bg-slate-700 px-1.5 py-0.5 rounded text-white">{getDatabaseName(deleteConfirmDatabase)}</span> to confirm:
          </p>
          <input
            type="text"
            value={deleteConfirmInput}
            onChange={(e) => setDeleteConfirmInput(e.target.value)}
            className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white text-sm focus:outline-none focus:border-red-500 mb-4"
            placeholder="Type database name"
            autoFocus
          />
          <div className="flex gap-2 justify-end">
            <button
              onClick={handleCancelDelete}
              className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white text-sm rounded transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirmDelete}
              disabled={deleteConfirmInput !== getDatabaseName(deleteConfirmDatabase)}
              className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Delete Forever
            </button>
          </div>
        </div>
      ) : (
      <div className="bg-slate-800 border border-slate-600 rounded-lg shadow-xl w-[600px] max-h-[700px] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-slate-600">
          <h3 className="text-white font-semibold">Select or Create Database</h3>
        </div>

        <div className="overflow-y-auto flex-1 p-4">
          {/* Action Buttons */}
          <div className="space-y-2 mb-4">
            <button
              onClick={handleCreateNew}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              <span>Create New Database</span>
            </button>

            <button
              onClick={handleSelectExisting}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-slate-700 hover:bg-slate-600 text-white text-sm rounded transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
              </svg>
              <span>Import Existing Database</span>
            </button>

            <button
              onClick={handleSwitchToDefault}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-green-700 hover:bg-green-600 text-white text-sm rounded transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
              </svg>
              <span>Open System Default</span>
            </button>
          </div>

          {/* Databases List */}
          {databases.length > 0 && (
            <div className="mt-4">
              <h4 className="text-slate-300 text-sm font-medium mb-2">Databases</h4>
              <div className="space-y-1 max-h-[300px] overflow-y-auto">
                {databases.map((dbPath, index) => (
                  <button
                    key={index}
                    onClick={() => handleSwitchToDatabase(dbPath)}
                    disabled={dbPath === currentDatabase}
                    className={`w-full flex items-center gap-2 px-3 py-2 rounded text-sm text-left transition-colors ${
                      dbPath === currentDatabase
                        ? 'bg-blue-600/20 border border-blue-500/50 text-blue-300 cursor-default'
                        : 'bg-slate-700/50 hover:bg-slate-700 text-slate-300 hover:text-white cursor-pointer'
                    }`}
                    title={dbPath}
                  >
                    <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
                    </svg>
                    <span className="truncate flex-1">{getDatabaseName(dbPath)}</span>
                    {dbPath === currentDatabase && (
                      <span className="text-xs text-blue-400 flex-shrink-0">Active</span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="px-4 py-3 border-t border-slate-600 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white text-sm rounded transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
