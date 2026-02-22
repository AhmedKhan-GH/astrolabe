import { useEffect } from 'react'

interface RootDirectoryContextMenuProps {
  x: number
  y: number
  onImportFile: () => void
  onReferenceFile: () => void
  onCreateFolder: () => void
  onExpandAll: () => void
  onCollapseAll: () => void
  onClearAll: () => void
  onClose: () => void
}

export default function RootDirectoryContextMenu({
  x,
  y,
  onImportFile,
  onReferenceFile,
  onCreateFolder,
  onExpandAll,
  onCollapseAll,
  onClearAll,
  onClose
}: RootDirectoryContextMenuProps) {
  useEffect(() => {
    const handleClickOutside = () => {
      onClose()
    }
    document.addEventListener('click', handleClickOutside)
    return () => document.removeEventListener('click', handleClickOutside)
  }, [onClose])

  return (
    <div
      className="fixed bg-slate-700 border border-slate-600 rounded shadow-lg py-1 z-50 w-[160px]"
      style={{ left: `${x}px`, top: `${y}px` }}
    >
      <button
        onClick={(e) => {
          e.stopPropagation()
          onImportFile()
        }}
        className="w-full text-left px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-600 cursor-pointer"
      >
        Import File
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation()
          onReferenceFile()
        }}
        className="w-full text-left px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-600 cursor-pointer"
      >
        Reference File
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation()
          onCreateFolder()
        }}
        className="w-full text-left px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-600 cursor-pointer"
      >
        New Folder
      </button>
      <div className="h-px bg-slate-600 my-1" />
      <button
        onClick={(e) => {
          e.stopPropagation()
          onExpandAll()
        }}
        className="w-full text-left px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-600 cursor-pointer"
      >
        Expand All
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation()
          onCollapseAll()
        }}
        className="w-full text-left px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-600 cursor-pointer"
      >
        Collapse All
      </button>
      <div className="h-px bg-slate-600 my-1" />
      <button
        onClick={(e) => {
          e.stopPropagation()
          onClearAll()
        }}
        className="w-full text-left px-3 py-1.5 text-red-400 text-sm hover:bg-slate-600 cursor-pointer"
      >
        Clear All
      </button>
    </div>
  )
}
