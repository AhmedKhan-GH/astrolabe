import { useState, useEffect, useRef } from 'react'
import FileNavigator from './components/FileNavigator'
import PDFViewer from './components/PDFViewer'
import ExcalidrawCanvas from './components/ExcalidrawCanvas'
import './App.css'

type AppContext = 'navigator' | 'viewer' | 'canvas'

function App() {
  const [context, setContext] = useState<AppContext>('navigator')
  const [pdfUrl, setPdfUrl] = useState<string>('')
  const [fileName, setFileName] = useState<string>('')
  const currentBlobUrl = useRef<string>('')

  const handleFileSelect = (file: File) => {
    setFileName(file.name)

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
  }

  const handleNavigateToCanvas = () => {
    setContext('canvas')
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
        <FileNavigator
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
          <PDFViewer pdfUrl={pdfUrl} />
        </div>
      )}
      {context === 'canvas' && (
        <ExcalidrawCanvas onNavigateToFiles={handleNavigateToFiles} />
      )}
    </div>
  )
}

export default App
