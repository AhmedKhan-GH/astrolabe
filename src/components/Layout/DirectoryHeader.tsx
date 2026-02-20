import { SixDotMenuIcon, PlusIcon, ImportFileIcon, ReferenceFileIcon, FolderIconLarge } from '../icons/FileIcons'
import { UI_LABELS } from '../../config/constants'

interface DirectoryHeaderProps {
  onMenuClick: (e: React.MouseEvent) => void
  onUploadFile: () => void
  onReferenceFile: () => void
  onCreateFolder: () => void
}

export default function DirectoryHeader({ onMenuClick, onUploadFile: onImportFile, onReferenceFile, onCreateFolder }: DirectoryHeaderProps) {
  return (
    <div className="flex items-center justify-between py-1 mb-2">
      <div className="flex items-center gap-2">
        <button
          onClick={onMenuClick}
          className="flex items-center justify-center w-6 h-6 text-slate-400 hover:text-white hover:bg-slate-700/50 hover:border-slate-600 border border-transparent rounded transition-all"
          title="Directory options"
        >
          <SixDotMenuIcon className="w-3 h-3" />
        </button>
        <h2 className="text-white text-lg font-semibold">{UI_LABELS.DIRECTORY}</h2>
      </div>
      <div className="flex gap-1 ml-2">
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
