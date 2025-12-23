import './ExcalidrawCanvas.css'

interface ExcalidrawCanvasProps {
  onNavigateToFiles: () => void
}

function ExcalidrawCanvas({ onNavigateToFiles }: ExcalidrawCanvasProps) {
  return (
    <div className="excalidraw-canvas">
      <div className="canvas-header">
        <button onClick={onNavigateToFiles} className="back-button">
          ← Files
        </button>
        <h2>Notes</h2>
        <div className="header-spacer"></div>
      </div>
      <div className="canvas-content">
        <div className="placeholder-message">
          <p>Excalidraw Canvas</p>
          <p className="placeholder-hint">Coming soon</p>
        </div>
      </div>
    </div>
  )
}

export default ExcalidrawCanvas
