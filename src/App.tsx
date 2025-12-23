import { useState, useEffect } from 'react'
import PDFViewer from './components/PDFViewer'
import './App.css'

function App() {
  const [pdfUrl, setPdfUrl] = useState<string>('')
  const [fileName, setFileName] = useState<string>('')

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file && file.type === 'application/pdf') {
      setFileName(file.name)

      // Revoke previous blob URL to free memory
      if (pdfUrl) {
        URL.revokeObjectURL(pdfUrl)
      }

      // Create blob URL for immediate use
      const url = URL.createObjectURL(file)
      setPdfUrl(url)
    } else {
      alert('Please select a valid PDF file')
    }
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
      <div className="file-header">
        <h2>{fileName || ''}</h2>
        <label htmlFor="pdf-upload" className="upload-label">
          {fileName ? 'Load Different PDF' : 'Load PDF File'}
        </label>
        <input
          id="pdf-upload"
          type="file"
          accept="application/pdf"
          onChange={handleFileUpload}
          className="upload-input"
        />
      </div>
      <PDFViewer pdfUrl={pdfUrl} />
    </div>
  )
}

export default App
