import FileFilterButton from './FileFilterButton'
import type { File } from '../../db/schema'

interface FileFilterProps {
  files?: File[]
}

function FileFilter({ files = [] }: FileFilterProps) {
  const handleFilterClick = (id: string) => {
    console.log('Filter item clicked:', id)
  }

  const allCount = files.length
  const importsCount = files.filter(f => f.fileStorageType === 'import').length
  const referencesCount = files.filter(f => f.fileStorageType === 'reference').length
  const trashCount = 0 // TODO: Implement trash functionality

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
        />
      ))}
    </div>
  )
}

export default FileFilter
