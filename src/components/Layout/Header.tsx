interface HeaderProps {
  onToggleSidebar: () => void
  onToggleRightSidebar: () => void
}

function Header({ onToggleSidebar, onToggleRightSidebar }: HeaderProps) {
  return (
    <div className="flex items-center justify-between gap-2 p-2 bg-slate-800 border-b border-slate-700">
      <div className="flex gap-2">
        <button
          onClick={onToggleSidebar}
          className="flex items-center gap-1 px-3 py-1 rounded border border-slate-600 text-slate-300 hover:bg-slate-700/50 hover:text-white transition-colors"
          title="Toggle sidebar"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            viewBox="0 0 24 24"
          >
            <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
            <line x1="9" x2="9" y1="3" y2="21" />
          </svg>
        </button>
      </div>

      <div className="flex gap-2 items-center">
        <button
          onClick={onToggleRightSidebar}
          className="flex items-center gap-1 px-3 py-1 rounded border border-slate-600 text-slate-300 hover:bg-slate-700/50 hover:text-white transition-colors"
          title="Toggle right sidebar"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            viewBox="0 0 24 24"
          >
            <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
            <line x1="15" x2="15" y1="3" y2="21" />
          </svg>
        </button>
      </div>
    </div>
  )
}

export default Header
