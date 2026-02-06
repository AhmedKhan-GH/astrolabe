import { useEffect } from 'react'

interface MergeFolderModalProps {
  folderName: string
  onConfirm: () => void
  onCancel: () => void
}

export default function MergeFolderModal({ folderName, onConfirm, onCancel }: MergeFolderModalProps) {
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCancel()
      }
    }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [onCancel])

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onCancel}>
      <div className="bg-slate-800 border border-slate-600 rounded-lg shadow-xl w-[480px] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-slate-600">
          <h3 className="text-white font-semibold text-lg">Merge Folders?</h3>
        </div>

        <div className="px-6 py-4">
          <p className="text-slate-300 leading-relaxed">
            A folder with the name <span className="text-white font-semibold">"{folderName}"</span> already exists at the destination.
          </p>
          <p className="text-slate-300 leading-relaxed mt-3">
            Would you like to merge the contents? This will move all files and subfolders from the source folder into the existing folder, then remove the source folder.
          </p>
        </div>

        <div className="px-6 py-4 border-t border-slate-600 flex justify-end gap-3">
          <button
            onClick={onCancel}
            className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white text-sm rounded transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded transition-colors"
          >
            Merge Contents
          </button>
        </div>
      </div>
    </div>
  )
}
