interface FolderInputFormProps {
  folderName: string
  onFolderNameChange: (name: string) => void
  onSubmit: () => void
  onCancel: () => void
}

export default function FolderInputForm({ folderName, onFolderNameChange, onSubmit, onCancel }: FolderInputFormProps) {
  return (
    <div className="mb-4 p-3 bg-slate-700/50 rounded border border-slate-600">
      <input
        type="text"
        value={folderName}
        onChange={(e) => onFolderNameChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onSubmit()
          if (e.key === 'Escape') onCancel()
        }}
        placeholder="Folder name"
        autoFocus
        className="w-full px-2 py-1 bg-slate-800 border border-slate-600 rounded text-slate-200 text-sm focus:outline-none focus:border-slate-500 mb-2"
      />
      <div className="flex gap-2">
        <button
          onClick={onSubmit}
          className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded transition-colors"
        >
          Create
        </button>
        <button
          onClick={onCancel}
          className="px-3 py-1 bg-slate-600 hover:bg-slate-700 text-white text-sm rounded transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
