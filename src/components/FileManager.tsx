import { useState, useEffect, useRef } from 'react'
import { saveFile, getAllFiles, deleteFile, clearAllFiles } from '../utils/fileStorage'
import { exportToJSON, importFromJSON } from '../utils/exportImport'
import './FileManager.css'

interface FileNavigatorProps {
  onFileSelect: (file: File) => void
  onNavigateToCanvas: () => void
}

function FileManager({ onFileSelect, onNavigateToCanvas }: FileNavigatorProps) {
  const [files, setFiles] = useState<File[]>([])
  const [loading, setLoading] = useState(true)
  const [showWorkspaceMenu, setShowWorkspaceMenu] = useState(false)
  const [workspaceName, setWorkspaceName] = useState('')
  const [inputWidth, setInputWidth] = useState(280)
  const importInputRef = useRef<HTMLInputElement>(null)
  const workspaceMenuRef = useRef<HTMLDivElement>(null)
  const nameInputRef = useRef<HTMLInputElement>(null)
  const measureSpanRef = useRef<HTMLSpanElement>(null)

  // Reusable function to calculate input width
  const calculateInputWidth = (textValue?: string) => {
    setTimeout(() => {
      if (measureSpanRef.current) {
        // Measure "Workspace Name" to get the base width and margin
        measureSpanRef.current.textContent = 'Workspace Name'
        const placeholderWidth = measureSpanRef.current.offsetWidth

        const margin = placeholderWidth
        const minWidth = placeholderWidth * 2

        // Measure current text
        const textToMeasure = textValue !== undefined ? textValue : (workspaceName || 'Workspace Name')
        measureSpanRef.current.textContent = textToMeasure || 'Workspace Name'
        const textWidth = measureSpanRef.current.offsetWidth

        const finalWidth = Math.max(textWidth + margin, minWidth)
        setInputWidth(finalWidth)
      }
    }, 0)
  }

  // Load persisted files and workspace name on mount
  useEffect(() => {
    loadFiles()
    const savedName = localStorage.getItem('workspaceName')
    if (savedName !== null) {
      setWorkspaceName(savedName)
      // Recalculate width after loading saved name
      setTimeout(() => calculateInputWidth(savedName), 10)
    } else {
      // Calculate initial width even if no saved name
      setTimeout(() => calculateInputWidth(''), 10)
    }
  }, [])

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (workspaceMenuRef.current && !workspaceMenuRef.current.contains(event.target as Node)) {
        setShowWorkspaceMenu(false)
      }
    }

    if (showWorkspaceMenu) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showWorkspaceMenu])

  // Update input width based on content with consistent margins
  useEffect(() => {
    if (measureSpanRef.current) {
      // Measure "Workspace Name" to get the base width and margin
      measureSpanRef.current.textContent = 'Workspace Name'
      const placeholderWidth = measureSpanRef.current.offsetWidth

      // The margin is exactly equal to the placeholder width
      const margin = placeholderWidth

      // Minimum width is double the placeholder width
      const minWidth = placeholderWidth * 2

      // Measure current text
      const textToMeasure = workspaceName || 'Workspace Name'
      measureSpanRef.current.textContent = textToMeasure
      const textWidth = measureSpanRef.current.offsetWidth

      // Always apply the same margin, but respect minimum width
      const finalWidth = Math.max(textWidth + margin, minWidth)

      setInputWidth(finalWidth)
    }
  }, [workspaceName])

  const loadFiles = async () => {
    try {
      const persistedFiles = await getAllFiles()
      setFiles(persistedFiles)
    } catch (error) {
      console.error('Failed to load files:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = event.target.files
    if (selectedFiles) {
      const pdfFiles = Array.from(selectedFiles).filter(
        file => file.type === 'application/pdf'
      )

      // Save each file to IndexedDB
      for (const file of pdfFiles) {
        try {
          await saveFile(file)
        } catch (error) {
          console.error(`Failed to save ${file.name}:`, error)
        }
      }

      // Reload all files
      const allFiles = await getAllFiles()
      setFiles(allFiles)
    }
  }

  const handleFileClick = (file: File) => {
    onFileSelect(file)
  }

  const handleFileDelete = async (file: File, event: React.MouseEvent) => {
    event.stopPropagation()
    try {
      await deleteFile(file.name)
      const allFiles = await getAllFiles()
      setFiles(allFiles)
    } catch (error) {
      console.error('Failed to delete file:', error)
    }
  }

  const handleExport = async () => {
    setShowWorkspaceMenu(false)
    try {
      await exportToJSON(workspaceName)
    } catch (error) {
      alert('Export failed: ' + (error as Error).message)
    }
  }

  const handleImportClick = () => {
    setShowWorkspaceMenu(false)
    importInputRef.current?.click()
  }

  const handleImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    try {
      const importedWorkspaceName = await importFromJSON(file)
      // Always set the workspace name, even if it's blank
      const nameToSet = importedWorkspaceName || ''
      setWorkspaceName(nameToSet)
      localStorage.setItem('workspaceName', nameToSet)


      await loadFiles()
      alert('Import successful!')

      // Recalculate width as final step after import
      calculateInputWidth(nameToSet)
    } catch (error) {
      alert('Import failed: ' + (error as Error).message)
    }

    // Reset input
    event.target.value = ''
  }

  const handleNameChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setWorkspaceName(event.target.value)
  }

  const handleNameBlur = () => {
    const trimmedName = workspaceName.trim()
    setWorkspaceName(trimmedName)
    localStorage.setItem('workspaceName', trimmedName)

    // Recalculate width as final step after blur
    calculateInputWidth(trimmedName)
  }

  const handleNameKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      nameInputRef.current?.blur()
    }
  }

  const handleReset = async () => {
    setShowWorkspaceMenu(false)
    if (!confirm('Are you sure you want to delete all files? This cannot be undone.')) {
      return
    }

    try {
      await clearAllFiles()
      await loadFiles()
      setWorkspaceName('New Workspace')
      localStorage.setItem('workspaceName', 'New Workspace')

      // Recalculate width as final step after reset
      calculateInputWidth('New Workspace')
    } catch (error) {
      alert('Reset failed: ' + (error as Error).message)
    }
  }

  if (loading) {
    return (
      <div className="file-navigator">
        <div className="loading-state">Loading files...</div>
      </div>
    )
  }

  return (
    <div className="file-navigator">
      <div className="navigator-header">
        <div className="header-left-actions">
          <label htmlFor="file-add" className="action-button">
            Add Files
          </label>
          <div className="workspace-dropdown" ref={workspaceMenuRef}>
            <button 
              onClick={() => setShowWorkspaceMenu(!showWorkspaceMenu)} 
              className="action-button"
            >
              Workspace {showWorkspaceMenu ? '▼' : '▶'}
            </button>
            {showWorkspaceMenu && (
              <div className="workspace-menu">
                <button onClick={handleExport} className="menu-item">
                  Export
                </button>
                <button onClick={handleImportClick} className="menu-item">
                  Import
                </button>
                <button onClick={handleReset} className="menu-item">
                  Reset
                </button>
              </div>
            )}
          </div>
        </div>
        <input
          ref={nameInputRef}
          type="text"
          value={workspaceName}
          onChange={handleNameChange}
          onBlur={handleNameBlur}
          onKeyDown={handleNameKeyDown}
          className="workspace-name-input"
          placeholder="Workspace Name"
          style={{ width: `${inputWidth}px` }}
        />
        <span ref={measureSpanRef} className="workspace-name-measure">
          {workspaceName || 'Workspace Name'}
        </span>
        <button onClick={onNavigateToCanvas} className="action-button">
          Notes →
        </button>
        <input
          id="file-add"
          type="file"
          accept="application/pdf"
          multiple
          onChange={handleFileUpload}
          className="file-input"
        />
        <input
          ref={importInputRef}
          type="file"
          accept=".astro"
          onChange={handleImport}
          className="file-input"
        />
      </div>

      <div className="file-list">
        {files.length === 0 ? (
          <div className="empty-state">
            <p>No files yet</p>
            <p className="empty-hint">Add PDF files to get started</p>
          </div>
        ) : (
          files.map((file, index) => (
            <div
              key={`${file.name}-${index}`}
              className="file-item"
              onClick={() => handleFileClick(file)}
            >
              <div className="file-info">
                <div className="file-name">{file.name}</div>
                <div className="file-size">
                  {(file.size / 1024 / 1024).toFixed(2)} MB
                </div>
              </div>
              <button
                className="delete-button"
                onClick={(e) => handleFileDelete(file, e)}
                title="Delete file"
              >
                ×
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

export default FileManager
