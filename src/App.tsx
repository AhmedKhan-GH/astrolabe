import { useState, useEffect, useRef } from 'react'
import FileManager from './components/FileManager.tsx'
import DocumentViewer from './components/DocumentViewer.tsx'
import NoteEditor from './components/NoteEditor.tsx'
import './App.css'

type AppContext = 'navigator' | 'viewer' | 'canvas'

function App() {
  const [context, setContext] = useState<AppContext>('navigator')
  const [pdfUrl, setPdfUrl] = useState<string>('')
  const [fileName, setFileName] = useState<string>('')
  const [fileId, setFileId] = useState<string>('')
  const currentBlobUrl = useRef<string>('')

  // Restore current file state on mount
  useEffect(() => {
    const savedContext = localStorage.getItem('currentContext') as AppContext | null
    const savedFileName = localStorage.getItem('currentFileName')
    const savedFileId = localStorage.getItem('currentFileId')

    if (savedContext && savedFileName && savedFileId) {
      // Try to reload the file from IndexedDB
      import('./utils/fileStorage').then(({ getAllFiles }) => {
        getAllFiles().then(files => {
          const file = files.find(f => `${f.name}-${f.size}` === savedFileId)
          if (file) {
            // Recreate blob URL
            const url = URL.createObjectURL(file)
            currentBlobUrl.current = url
            setPdfUrl(url)
            setFileName(savedFileName)
            setFileId(savedFileId)
            setContext(savedContext)
          } else {
            // File not found, clear saved state
            localStorage.removeItem('currentContext')
            localStorage.removeItem('currentFileName')
            localStorage.removeItem('currentFileId')
          }
        }).catch(err => {
          console.error('Failed to restore file:', err)
        })
      })
    }
  }, [])

  const handleFileSelect = (file: File) => {
    const newFileId = `${file.name}-${file.size}`
    setFileName(file.name)
    setFileId(newFileId)

    // Save current file state
    localStorage.setItem('currentContext', 'viewer')
    localStorage.setItem('currentFileName', file.name)
    localStorage.setItem('currentFileId', newFileId)

    // Only revoke if we're replacing with a different file
    if (currentBlobUrl.current && currentBlobUrl.current !== pdfUrl) {
      URL.revokeObjectURL(currentBlobUrl.current)
    }

    // Create blob URL for immediate use
    const url = URL.createObjectURL(file)
    currentBlobUrl.current = url
    setPdfUrl(url)
    setContext('viewer')
  }

  const handleNavigateToFiles = () => {
    setContext('navigator')
    localStorage.setItem('currentContext', 'navigator')
  }

  const handleNavigateToCanvas = () => {
    setContext('canvas')
    localStorage.setItem('currentContext', 'canvas')
  }

  // Cleanup blob URL only on unmount
  useEffect(() => {
    return () => {
      if (currentBlobUrl.current) {
        URL.revokeObjectURL(currentBlobUrl.current)
      }
    }
  }, [])

  return (
    <div className="app-container">
      {context === 'navigator' && (
        <FileManager
          onFileSelect={handleFileSelect}
          onNavigateToCanvas={handleNavigateToCanvas}
        />
      )}
      {context === 'viewer' && (
        <div className="viewer-container">
          <div className="viewer-header">
            <button onClick={handleNavigateToFiles} className="back-button">
              ← Files
            </button>
            <h2>{fileName}</h2>
            <button onClick={handleNavigateToCanvas} className="notes-button">
              Notes →
            </button>
          </div>
          <DocumentViewer pdfUrl={pdfUrl} fileId={fileId} />
        </div>
      )}
      {context === 'canvas' && (
        <NoteEditor onNavigateToFiles={handleNavigateToFiles} />
      )}
    </div>
  )
}

export default App
