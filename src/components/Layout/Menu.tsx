import MenuButton from './MenuButton'
import type { File } from '../../db/schema'

interface MenuProps {
  files?: File[]
}

function Menu({ files = [] }: MenuProps) {
  const handleMenuClick = (id: string) => {
    console.log('Menu item clicked:', id)
  }

  const allCount = files.length
  const importsCount = files.filter(f => f.fileStorageType === 'import').length
  const referencesCount = files.filter(f => f.fileStorageType === 'reference').length
  const trashCount = 0 // TODO: Implement trash functionality

  const menuItems = [
    { id: 'all', label: 'All', count: allCount },
    { id: 'trash', label: 'Trash', count: trashCount },
    { id: 'imports', label: 'Imports', count: importsCount },
    { id: 'references', label: 'References', count: referencesCount }
  ]

  return (
    <div className="border-b border-slate-700 py-1 mb-2">
      <h2 className="text-white text-lg font-semibold mb-0.5">Menu</h2>
      {menuItems.map((item) => (
        <MenuButton
          key={item.id}
          label={item.label}
          count={item.count}
          onClick={() => handleMenuClick(item.id)}
        />
      ))}
    </div>
  )
}

export default Menu
