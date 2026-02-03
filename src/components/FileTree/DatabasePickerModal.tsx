import { useEffect } from 'react'

interface DatabasePickerModalProps {
  onSelect: (dbPath: string) => void
  onClose: () => void
}

export default function DatabasePickerModal({ onSelect, onClose }: DatabasePickerModalProps) {

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

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-slate-800 border border-slate-600 rounded-lg shadow-xl w-[500px] max-h-[600px] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-slate-600">
          <h3 className="text-white font-semibold">Select or Create Database</h3>
          <p className="text-slate-400 text-xs mt-1">Choose an existing .astro database or create a new one</p>
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
              <span>Open Existing Database</span>
            </button>
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
    </div>
  )
}
