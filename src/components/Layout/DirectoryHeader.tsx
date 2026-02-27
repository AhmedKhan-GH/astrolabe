import { SixDotMenuIcon, PlusIcon, ImportFileIcon, ReferenceFileIcon, FolderIconLarge } from '../icons/FileIcons'
import { useRef, useEffect, useState } from 'react'

interface DirectoryHeaderProps {
  databaseName: string
  isSystemDefault: boolean
  databases: string[]
  currentDatabase: string | null
  defaultDatabase: string | null
  onMenuClick: (e: React.MouseEvent) => void
  onUploadFile: () => void
  onReferenceFile: () => void
  onCreateFolder: () => void
  onDatabaseSelect: (dbPath: string) => void
  onOpenDatabaseModal: () => void
}

export default function DirectoryHeader({
  databaseName,
  isSystemDefault,
  databases,
  currentDatabase,
  defaultDatabase,
  onMenuClick,
  onUploadFile: onImportFile,
  onReferenceFile,
  onCreateFolder,
  onDatabaseSelect,
  onOpenDatabaseModal
}: DirectoryHeaderProps) {
  const measureRef = useRef<HTMLSpanElement>(null)
  const [minWidth, setMinWidth] = useState(0)
  const [showDropdown, setShowDropdown] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (measureRef.current) {
      // Add extra space for the dropdown arrow and padding
      setMinWidth(measureRef.current.offsetWidth + 24)
    }
  }, [])

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false)
      }
    }
    if (showDropdown) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showDropdown])

  const handleDatabaseClick = (dbPath: string) => {
    setShowDropdown(false)
    onDatabaseSelect(dbPath)
  }

  const handleOpenModal = () => {
    setShowDropdown(false)
    onOpenDatabaseModal()
  }

  const getDatabaseName = (dbPath: string) => {
    return dbPath.split(/[\\/]/).pop() || dbPath
  }

  return (
    <div className="flex items-center py-0 mb-2 min-w-0 border-b border-slate-700 pb-2">
      <span ref={measureRef} className="absolute invisible text-lg font-semibold whitespace-nowrap">Database</span>
      <button
        onClick={onMenuClick}
        className="flex items-center justify-center w-5 h-5 text-slate-400 hover:text-white hover:bg-slate-700/50 hover:border-slate-600 border border-transparent rounded transition-all flex-shrink-0 mr-1"
        title="Directory options"
      >
        <SixDotMenuIcon className="w-3 h-3" />
      </button>

      <div className="relative mr-2" ref={dropdownRef}>
        <button
          onClick={() => setShowDropdown(!showDropdown)}
          className={`flex items-center gap-1.5 text-lg font-semibold truncate px-2 py-0.5 rounded transition-colors ${
            isSystemDefault
              ? 'text-green-300 hover:bg-green-700/20'
              : 'text-white hover:bg-slate-700/50'
          }`}
          style={{ minWidth: `${minWidth}px` }}
          title={currentDatabase || databaseName}
        >
          <span className="truncate">{databaseName}</span>
          <svg className="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {showDropdown && (
          <div className="absolute top-full left-0 mt-1 w-full min-w-[200px] bg-slate-800 border border-slate-600 rounded shadow-lg z-50 max-h-[300px] overflow-y-auto">
            {defaultDatabase && (
              <button
                onClick={() => handleDatabaseClick(defaultDatabase)}
                className={`w-full flex items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${
                  defaultDatabase === currentDatabase
                    ? 'bg-green-700/30 text-green-300'
                    : 'text-green-300 bg-green-700/20 hover:bg-green-700/30'
                }`}
              >
                <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
                </svg>
                <span className="truncate">Database</span>
                {defaultDatabase === currentDatabase && (
                  <svg className="w-4 h-4 flex-shrink-0 text-blue-400 ml-auto" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                )}
              </button>
            )}

            {databases.map((dbPath, index) => (
              <button
                key={index}
                onClick={() => handleDatabaseClick(dbPath)}
                className={`w-full flex items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${
                  dbPath === currentDatabase
                    ? 'bg-slate-700 text-white'
                    : 'text-slate-300 hover:bg-slate-700'
                }`}
              >
                <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
                </svg>
                <span className="truncate">{getDatabaseName(dbPath)}</span>
                {dbPath === currentDatabase && (
                  <svg className="w-4 h-4 flex-shrink-0 text-blue-400 ml-auto" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                )}
              </button>
            ))}

            <div className="border-t border-slate-600">
              <button
                onClick={handleOpenModal}
                className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm text-blue-400 hover:bg-slate-700 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
                <span>Manage Databases...</span>
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="flex gap-1 flex-shrink-0 ml-auto">
        <button
          onClick={onImportFile}
          className="group relative flex items-center justify-center gap-0.5 px-1.5 py-1 rounded border border-slate-600 text-slate-300 hover:bg-slate-700/50 hover:text-white transition-colors"
          title="Import file"
        >
          <PlusIcon className="w-2.5 h-2.5 group-hover:text-white" />
          <ImportFileIcon className="w-3 h-3 group-hover:brightness-125" />
        </button>
        <button
          onClick={onReferenceFile}
          className="group relative flex items-center justify-center gap-0.5 px-1.5 py-1 rounded border border-slate-600 text-slate-300 hover:bg-slate-700/50 hover:text-white transition-colors"
          title="Reference file"
        >
          <PlusIcon className="w-2.5 h-2.5 group-hover:text-white" />
          <ReferenceFileIcon className="w-3 h-3 group-hover:brightness-125" />
        </button>
        <button
          onClick={onCreateFolder}
          className="group relative flex items-center justify-center gap-0.5 px-1.5 py-1 rounded border border-slate-600 text-slate-300 hover:bg-slate-700/50 hover:text-white transition-colors"
          title="Create folder"
        >
          <PlusIcon className="w-2.5 h-2.5 group-hover:text-white" />
          <FolderIconLarge className="w-3 h-3 group-hover:text-slate-200" />
        </button>
      </div>
    </div>
  )
}
