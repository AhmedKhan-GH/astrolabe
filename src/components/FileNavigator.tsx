import { useState, useEffect } from 'react'
import { saveFile, getAllFiles, deleteFile } from '../utils/fileStorage'
import './FileNavigator.css'

interface FileNavigatorProps {
  onFileSelect: (file: File) => void
  onNavigateToCanvas: () => void
}

function FileNavigator({ onFileSelect, onNavigateToCanvas }: FileNavigatorProps) {
  const [files, setFiles] = useState<File[]>([])
  const [loading, setLoading] = useState(true)

  // Load persisted files on mount
  useEffect(() => {
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
    loadFiles()
  }, [])

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
        <label htmlFor="file-add" className="action-button">
          Add Files
        </label>
        <h2>Files</h2>
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

export default FileNavigator
