import { useEffect, useState } from 'react'
import { logger } from '../../utils/logger'
import { UI_LABELS } from '../../config/constants'

interface DatabasePickerModalProps {
  onSelect: (dbPath: string) => void
  onClose: () => void
}

export default function DatabasePickerModal({ onSelect, onClose }: DatabasePickerModalProps) {
  const [databases, setDatabases] = useState<string[]>([])
  const [currentDatabase, setCurrentDatabase] = useState<string | null>(null)
  const [defaultDatabase, setDefaultDatabase] = useState<string | null>(null)
  const [deleteConfirmDatabase, setDeleteConfirmDatabase] = useState<string | null>(null)
  const [deleteConfirmInput, setDeleteConfirmInput] = useState('')

  useEffect(() => {
    const loadDatabases = async () => {
      const dbList = await window.electron.getDatabasesList()
      const current = await window.electron.getCurrentDatabase()
      const defaultPath = await window.electron.getDefaultDatabasePath()

      // Filter out database from the list
      const customDatabases = dbList.filter(db => db !== defaultPath)

      setDatabases(customDatabases)
      setCurrentDatabase(current)
      setDefaultDatabase(defaultPath)
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
      logger.error({ error }, '[DatabasePickerModal] Failed to select database')
    }
  }

  const handleCreateNew = async () => {
    try {
      const result = await window.electron.createDatabaseFile()
      if (result) {
        onSelect(result)
      }
    } catch (error) {
      logger.error({ error }, '[DatabasePickerModal] Failed to create database')
    }
  }

  const handleSwitchToDatabase = async (dbPath: string) => {
    try {
      logger.info({ dbPath }, '[DatabasePickerModal] Switching to database')
      await window.electron.switchToDatabase(dbPath)
      // The IPC handler will reload the window, so onSelect won't be called
    } catch (error) {
      logger.error({ error, dbPath }, '[DatabasePickerModal] Failed to switch database')
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

  const getConfirmationText = (dbPath: string) => {
    // For Database, require typing "Database"
    if (dbPath === defaultDatabase) {
      return UI_LABELS.DATABASE
    }
    return getDatabaseName(dbPath)
  }

  const handleConfirmDelete = async () => {
    if (!deleteConfirmDatabase) return

    const confirmText = getConfirmationText(deleteConfirmDatabase)
    if (deleteConfirmInput !== confirmText) return

    try {
      const wasCurrentDatabase = deleteConfirmDatabase === currentDatabase
      await window.electron.deleteDatabase(deleteConfirmDatabase)
      setDeleteConfirmDatabase(null)
      setDeleteConfirmInput('')

      // If we deleted the current database, switch to database
      if (wasCurrentDatabase) {
        logger.info('[DatabasePickerModal] Deleted current database, switching to database')
        await window.electron.switchToDefaultDatabase()
        // Window will reload, so no need to update local state
      } else {
        logger.info('[DatabasePickerModal] Database deleted, reloading list')
        // Reload databases list
        const dbList = await window.electron.getDatabasesList()
        const customDatabases = dbList.filter(db => db !== defaultDatabase)
        setDatabases(customDatabases)
      }
    } catch (error) {
      logger.error({ error }, '[DatabasePickerModal] Failed to delete database')
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
            {deleteConfirmDatabase === defaultDatabase ? (
              <> This will reset the database and delete all its contents.</>
            ) : (
              <> This will permanently delete the database file from your system.</>
            )}
          </p>
          <p className="text-slate-300 text-sm mb-4">
            Type <span className="font-mono bg-slate-700 px-1.5 py-0.5 rounded text-white">{getConfirmationText(deleteConfirmDatabase)}</span> to confirm:
          </p>
          <input
            type="text"
            value={deleteConfirmInput}
            onChange={(e) => setDeleteConfirmInput(e.target.value)}
            onPaste={(e) => e.preventDefault()}
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
              disabled={deleteConfirmInput !== getConfirmationText(deleteConfirmDatabase)}
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
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
              </svg>
              <span>Import Existing Database</span>
            </button>
          </div>

          {/* Databases List */}
          <div className="mt-4">
            <h4 className="text-slate-300 text-sm font-medium mb-2">Databases</h4>
            <div className="space-y-1 max-h-[300px] overflow-y-auto">
              {/* Database - Always First */}
              {defaultDatabase && (
                <div className="relative group rounded text-sm bg-green-700/20 border border-green-600/30 text-green-300 hover:bg-green-700/30 transition-colors">
                  <button
                    onClick={() => handleSwitchToDatabase(defaultDatabase)}
                    className="w-full flex items-center gap-2 px-3 py-2 pr-10 text-left cursor-pointer"
                    title={defaultDatabase}
                  >
                    <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
                    </svg>
                    <span className="truncate">{UI_LABELS.DATABASE}</span>
                    {defaultDatabase === currentDatabase && (
                      <svg className="w-4 h-4 flex-shrink-0 text-green-400 ml-2" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                      </svg>
                    )}
                  </button>
                  <button
                    onClick={(e) => handleDeleteDatabase(defaultDatabase, e)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-red-600/30 transition-all z-10"
                    title="Reset default database"
                  >
                    <svg className="w-4 h-4 text-red-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              )}

              {/* Custom Databases */}
              {databases.map((dbPath, index) => (
                  <div
                    key={index}
                    className="relative group rounded text-sm bg-slate-700/50 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors"
                  >
                    <button
                      onClick={() => handleSwitchToDatabase(dbPath)}
                      className="w-full flex items-center gap-2 px-3 py-2 pr-10 text-left cursor-pointer"
                      title={dbPath}
                    >
                      <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
                      </svg>
                      <span className="truncate">{getDatabaseName(dbPath)}</span>
                      {dbPath === currentDatabase && (
                        <svg className="w-4 h-4 flex-shrink-0 text-green-400 ml-2" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                        </svg>
                      )}
                    </button>
                    <button
                      onClick={(e) => handleDeleteDatabase(dbPath, e)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-red-600/30 transition-all z-10"
                      title="Delete database"
                    >
                      <svg className="w-4 h-4 text-red-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                ))}
            </div>
          </div>
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
      )}
    </div>
  )
}
