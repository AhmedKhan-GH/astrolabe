interface DirectoryHeaderProps {
  onUploadFile: () => void
  onCreateFolder: () => void
}

export default function DirectoryHeader({ onUploadFile, onCreateFolder }: DirectoryHeaderProps) {
  return (
    <div className="flex items-center justify-between mb-4">
      <h2 className="text-white text-lg font-semibold">Directory</h2>
      <div className="flex gap-1">
        <button
          onClick={onUploadFile}
          className="flex items-center gap-1 px-1.5 py-1 rounded border border-slate-600 text-slate-300 hover:bg-slate-700/50 hover:text-white transition-colors"
          title="Upload file"
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
          </svg>
        </button>
        <button
          onClick={onCreateFolder}
          className="flex items-center gap-1 px-1.5 py-1 rounded border border-slate-600 text-slate-300 hover:bg-slate-700/50 hover:text-white transition-colors"
          title="Create folder"
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
          </svg>
        </button>
      </div>
    </div>
  )
}
