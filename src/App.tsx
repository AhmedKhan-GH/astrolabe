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
  const [showNoteEditor, setShowNoteEditor] = useState<boolean>(false)
  const [viewerPanelWidth, setViewerPanelWidth] = useState<number>(window.innerWidth / 2)
  const [isResizingNote, setIsResizingNote] = useState<boolean>(false)
  const currentBlobUrl = useRef<string>('')

  // Restore current file state on mount
  useEffect(() => {
    const savedContext = localStorage.getItem('currentContext') as AppContext | null
    const savedFileName = localStorage.getItem('currentFileName')
    const savedFileId = localStorage.getItem('currentFileId')
    const savedShowNoteEditor = localStorage.getItem('showNoteEditor') === 'true'

    if (savedContext && savedFileName && savedFileId) {
      // Try to reload the file from IndexedDB
      import('./utils/fileStorage').then(({ getAllFiles }) => {
        getAllFiles().then(files => {
          const file = files.find((f: File & { uniqueId?: string }) => f.uniqueId === savedFileId)
          if (file) {
            // Recreate blob URL
            const url = URL.createObjectURL(file)
            currentBlobUrl.current = url
            setPdfUrl(url)
            setFileName(savedFileName)
            setFileId(savedFileId)
            setContext(savedContext)
            setShowNoteEditor(savedShowNoteEditor)
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

  const handleFileSelect = (file: File & { uniqueId?: string }) => {
    // Use the unique instance ID if available, otherwise generate one
    const newFileId = file.uniqueId || `${Date.now()}-${file.name}`
    setFileName(file.name)
    setFileId(newFileId)
    setShowNoteEditor(false)

    // Save current file state
    localStorage.setItem('currentContext', 'viewer')
    localStorage.setItem('currentFileName', file.name)
    localStorage.setItem('currentFileId', newFileId)
    localStorage.setItem('showNoteEditor', 'false')

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
    setShowNoteEditor(false)
    localStorage.setItem('currentContext', 'navigator')
    localStorage.setItem('showNoteEditor', 'false')
  }

  const handleToggleNoteEditor = () => {
    const newValue = !showNoteEditor
    setShowNoteEditor(newValue)
    localStorage.setItem('showNoteEditor', String(newValue))
  }

  const handleNoteResizeStart = (e: React.MouseEvent) => {
    e.preventDefault()
    setIsResizingNote(true)
  }

  const handleNoteResizeMove = (e: MouseEvent) => {
    if (isResizingNote) {
      const minPdfViewerWidth = 400 // Minimum width for PDF viewer panel
      const minNoteWidth = 500 // Minimum width for note panel
      const resizeHandleWidth = 12 // Width of the resize handle

      // New viewer panel width is the mouse X position
      const newViewerWidth = e.clientX

      // Calculate the maximum viewer width (leaving minimum space for note panel)
      const maxViewerWidth = window.innerWidth - minNoteWidth - resizeHandleWidth

      // Clamp the viewer width between minimum and maximum
      // This prevents BOTH:
      // - Viewer from being smaller than 400px (stops note from expanding too much)
      // - Note from being smaller than 500px (stops viewer from expanding too much)
      const clampedViewerWidth = Math.max(minPdfViewerWidth, Math.min(maxViewerWidth, newViewerWidth))

      setViewerPanelWidth(clampedViewerWidth)
    }
  }

  const handleNoteResizeEnd = () => {
    setIsResizingNote(false)
  }

  // Effect to handle resize mouse events
  useEffect(() => {
    if (isResizingNote) {
      document.body.style.userSelect = 'none'
      document.body.style.cursor = 'col-resize'
      document.addEventListener('mousemove', handleNoteResizeMove)
      document.addEventListener('mouseup', handleNoteResizeEnd)
      return () => {
        document.body.style.userSelect = ''
        document.body.style.cursor = ''
        document.removeEventListener('mousemove', handleNoteResizeMove)
        document.removeEventListener('mouseup', handleNoteResizeEnd)
      }
    }
  }, [isResizingNote])

  // Effect to handle window resize - maintain proportions
  useEffect(() => {
    if (!showNoteEditor) return

    let previousWindowWidth = window.innerWidth
    let resizeTimeout: ReturnType<typeof setTimeout> | null = null

    const handleWindowResize = () => {
      const minPdfViewerWidth = 400
      const minNoteWidth = 500
      const resizeHandleWidth = 12
      const currentWindowWidth = window.innerWidth

      // Calculate the ratio of viewer panel to total available width
      const previousAvailableWidth = previousWindowWidth - resizeHandleWidth
      const viewerRatio = viewerPanelWidth / previousAvailableWidth

      // Apply the same ratio to the new window width
      const newAvailableWidth = currentWindowWidth - resizeHandleWidth
      let newViewerWidth = viewerRatio * newAvailableWidth

      // Clamp to ensure both panels meet minimum requirements
      const maxViewerWidth = newAvailableWidth - minNoteWidth
      newViewerWidth = Math.max(minPdfViewerWidth, Math.min(maxViewerWidth, newViewerWidth))

      // Only update if the width actually changed
      if (Math.abs(newViewerWidth - viewerPanelWidth) > 1) {
        setViewerPanelWidth(newViewerWidth)
      }

      previousWindowWidth = currentWindowWidth
    }

    window.addEventListener('resize', handleWindowResize)
    return () => {
      window.removeEventListener('resize', handleWindowResize)
      if (resizeTimeout) {
        clearTimeout(resizeTimeout)
      }
    }
  }, [showNoteEditor, viewerPanelWidth])

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
        />
      )}
      {context === 'viewer' && (
        <div className="viewer-container">
          <div className="viewer-header">
            <button onClick={handleNavigateToFiles} className="back-button">
              ← Files
            </button>
            <h2>{fileName}</h2>
            <button onClick={handleToggleNoteEditor} className="notes-button">
              Excalidraw
            </button>
          </div>
          <div className={`viewer-content ${showNoteEditor ? 'split-view' : ''} ${isResizingNote ? 'resizing' : ''}`}>
            <div className="viewer-panel" style={{ width: showNoteEditor ? `${viewerPanelWidth}px` : '100%' }}>
              <DocumentViewer 
                pdfUrl={pdfUrl} 
                fileId={fileId} 
                isParentResizing={isResizingNote}
                availableWidth={showNoteEditor ? viewerPanelWidth : window.innerWidth}
              />
            </div>
            {showNoteEditor && (
              <>
                <div className="note-resize-handle" onMouseDown={handleNoteResizeStart}></div>
                <div className="note-panel" style={{ flex: 1, minWidth: '500px' }}>
                  <NoteEditor onNavigateToFiles={handleNavigateToFiles} fileId={fileId} />
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default App
