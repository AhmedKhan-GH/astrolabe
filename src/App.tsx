import { useState, useEffect } from 'react'
import PDFViewer from './components/PDFViewer'
import './App.css'

function App() {
  const [pdfUrl, setPdfUrl] = useState<string>('')
  const [fileName, setFileName] = useState<string>('')

  // Load PDF from localStorage on mount
  useEffect(() => {
    const storedFileName = localStorage.getItem('pdfFileName')
    const storedPdfData = localStorage.getItem('pdfData')

    if (storedFileName && storedPdfData) {
      setFileName(storedFileName)
      // Convert base64 back to blob URL
      const byteCharacters = atob(storedPdfData)
      const byteNumbers = new Array(byteCharacters.length)
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i)
      }
      const byteArray = new Uint8Array(byteNumbers)
      const blob = new Blob([byteArray], { type: 'application/pdf' })
      const url = URL.createObjectURL(blob)
      setPdfUrl(url)
    }
  }, [])

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file && file.type === 'application/pdf') {
      setFileName(file.name)

      // Create blob URL for immediate use
      const url = URL.createObjectURL(file)
      setPdfUrl(url)

      // Store in localStorage as base64
      const fileReader = new FileReader()
      fileReader.onload = function() {
        const arrayBuffer = this.result as ArrayBuffer
        const bytes = new Uint8Array(arrayBuffer)
        let binary = ''
        for (let i = 0; i < bytes.byteLength; i++) {
          binary += String.fromCharCode(bytes[i])
        }
        const base64 = btoa(binary)

        localStorage.setItem('pdfFileName', file.name)
        localStorage.setItem('pdfData', base64)
      }
      fileReader.readAsArrayBuffer(file)
    } else {
      alert('Please select a valid PDF file')
    }
  }

  const handleReset = () => {
    // Revoke the blob URL to free memory
    if (pdfUrl) {
      URL.revokeObjectURL(pdfUrl)
    }
    setPdfUrl('')
    setFileName('')
    localStorage.removeItem('pdfFileName')
    localStorage.removeItem('pdfData')
  }

  // Cleanup blob URL on unmount
  useEffect(() => {
    return () => {
      if (pdfUrl) {
        URL.revokeObjectURL(pdfUrl)
      }
    }
  }, [pdfUrl])

  return (
    <div className="app-container">
      {!pdfUrl ? (
        <div className="upload-container">
          <h1>PDF Viewer with TOC</h1>
          <p>Upload a PDF file from your computer</p>
          <div className="upload-box">
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#646cff" strokeWidth="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
              <polyline points="14 2 14 8 20 8"></polyline>
              <line x1="12" y1="18" x2="12" y2="12"></line>
              <line x1="9" y1="15" x2="15" y2="15"></line>
            </svg>
            <label htmlFor="pdf-upload" className="upload-label">
              Choose PDF File
            </label>
            <input
              id="pdf-upload"
              type="file"
              accept="application/pdf"
              onChange={handleFileUpload}
              className="upload-input"
            />
            <p className="upload-text">
              Click to browse or drag and drop
            </p>
          </div>
        </div>
      ) : (
        <>
          <div className="file-header">
            <h2>{fileName}</h2>
            <button onClick={handleReset}>
              Load Different PDF
            </button>
          </div>
          <PDFViewer pdfUrl={pdfUrl} />
        </>
      )}
    </div>
  )
}

export default App
