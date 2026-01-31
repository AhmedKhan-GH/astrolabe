interface HeaderProps {
  onToggleSidebar: () => void
}

function Header({ onToggleSidebar }: HeaderProps) {
  return (
    <div className="flex gap-2 p-2 bg-slate-800 border-b border-slate-700">
      <button
        onClick={onToggleSidebar}
        className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-white rounded transition-colors"
      >
        <svg
          className="w-5 h-5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M4 6h16M4 12h16M4 18h16"
          />
        </svg>
      </button>
    </div>
  )
}

export default Header
