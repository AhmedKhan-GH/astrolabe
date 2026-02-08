import { useEffect, useRef } from 'react'

interface FolderInputFormProps {
  folderName: string
  onFolderNameChange: (name: string) => void
  onSubmit: () => void
  onCancel: () => void
  isDuplicate?: boolean
}

export default function FolderInputForm({ folderName, onFolderNameChange, onSubmit, onCancel, isDuplicate = false }: FolderInputFormProps) {
  const modalRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
        onCancel()
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [onCancel])

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div ref={modalRef} className="bg-slate-800 rounded-lg shadow-xl border border-slate-600 p-6 w-96">
        <h2 className="text-lg font-semibold text-slate-200 mb-4">Create New Folder</h2>
        <input
          type="text"
          value={folderName}
          onChange={(e) => onFolderNameChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !isDuplicate) onSubmit()
            if (e.key === 'Escape') onCancel()
          }}
          placeholder="Folder name"
          autoFocus
          className={`w-full px-3 py-2 bg-slate-700 border rounded text-slate-200 text-sm focus:outline-none mb-1 ${
            isDuplicate ? 'border-red-500 focus:border-red-500' : 'border-slate-600 focus:border-blue-500'
          }`}
        />
        {isDuplicate && (
          <p className="text-red-400 text-xs mb-3">A folder with this name already exists at this level</p>
        )}
        <div className="flex gap-2 justify-end">
          <button
            onClick={onCancel}
            className="px-4 py-2 bg-slate-600 hover:bg-slate-700 text-white text-sm rounded transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onSubmit}
            disabled={isDuplicate}
            className={`px-4 py-2 text-white text-sm rounded transition-colors ${
              isDuplicate
                ? 'bg-slate-600 cursor-not-allowed opacity-50'
                : 'bg-blue-600 hover:bg-blue-700'
            }`}
          >
            Create
          </button>
        </div>
      </div>
    </div>
  )
}
