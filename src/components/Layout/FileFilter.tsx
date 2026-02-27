import FileFilterButton from './FileFilterButton'
import type { File } from '../../db/schema'

interface FileFilterProps {
  files?: File[]
  selectedFilter?: string
  onFilterChange?: (filter: string) => void
}

function FileFilter({ files = [], selectedFilter = 'all', onFilterChange }: FileFilterProps) {
  const handleFilterClick = (id: string) => {
    onFilterChange?.(id)
  }

  const allCount = files.filter(f => f.fileStorageType !== 'trash').length
  const importsCount = files.filter(f => f.fileStorageType === 'import').length
  const referencesCount = files.filter(f => f.fileStorageType === 'reference').length
  const trashCount = files.filter(f => f.fileStorageType === 'trash').length

  const filterItems = [
    { id: 'all', label: 'All', count: allCount },
    { id: 'trash', label: 'Trash', count: trashCount },
    { id: 'imports', label: 'Imports', count: importsCount },
    { id: 'references', label: 'References', count: referencesCount }
  ]

  return (
    <div className="border-b border-slate-700 pb-2 mb-2">
      {filterItems.map((item) => (
        <FileFilterButton
          key={item.id}
          label={item.label}
          count={item.count}
          onClick={() => handleFilterClick(item.id)}
          isActive={selectedFilter === item.id}
        />
      ))}
    </div>
  )
}

export default FileFilter
