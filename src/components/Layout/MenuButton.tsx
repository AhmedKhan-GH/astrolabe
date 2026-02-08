import { FolderIconLarge } from '../icons/FileIcons'

interface MenuButtonProps {
  label: string
  count?: number
  onClick?: () => void
}

export default function MenuButton({ label, count, onClick }: MenuButtonProps) {
  return (
    <div
      className="flex items-center justify-between py-1 px-3 cursor-pointer text-sm hover:bg-slate-700/50 rounded group"
      onClick={onClick}
    >
      <div className="flex items-center">
        <div className="mr-2 flex-shrink-0">
          <FolderIconLarge />
        </div>
        <span className="text-slate-200 truncate">{label}</span>
      </div>
      {count !== undefined && (
        <span className="text-slate-400 text-xs ml-2">{count}</span>
      )}
    </div>
  )
}
