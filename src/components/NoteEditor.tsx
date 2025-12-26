import { useState, useEffect, useCallback, useRef } from 'react'
import { Excalidraw } from '@excalidraw/excalidraw'
import '@excalidraw/excalidraw/index.css'
import './NoteEditor.css'

interface ExcalidrawCanvasProps {
  onNavigateToFiles: () => void
  fileId?: string
}

function NoteEditor({ onNavigateToFiles, fileId }: ExcalidrawCanvasProps) {
  const STORAGE_KEY = fileId ? `excalidraw-drawing-${fileId}` : 'excalidraw-drawing'
  const [initialData, setInitialData] = useState<any>(null)
  const [isLoading, setIsLoading] = useState(true)

  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hasLoadedRef = useRef(false)
  const lastSavedElementsRef = useRef<any[] | null>(null)
  const currentElementsRef = useRef<any[]>([])
  const currentAppStateRef = useRef<any>(null)
  const pendingSaveRef = useRef(false)

  const loadDrawing = useCallback(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) {
        const data = JSON.parse(saved)
        setInitialData(data)
        lastSavedElementsRef.current = data.elements || []
        currentElementsRef.current = data.elements || []
        console.log('Loaded drawing with', data.elements?.length || 0, 'elements')
      } else {
        lastSavedElementsRef.current = []
        console.log('No saved drawing found')
      }
      hasLoadedRef.current = true
    } catch (err) {
      console.error('Failed to load drawing:', err)
      lastSavedElementsRef.current = []
    } finally {
      setIsLoading(false)
    }
  }, [])

  const saveDrawingSync = useCallback((elements: any[], appState: any) => {
    try {
      const data = {
        elements,
        appState: {
          viewBackgroundColor: appState?.viewBackgroundColor,
        },
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
      console.log('Saved', elements.length, 'elements to localStorage')
      pendingSaveRef.current = false
    } catch (err) {
      console.error('Failed to save drawing:', err)
    }
  }, [])

  // Initial load
  useEffect(() => {
    loadDrawing()

    const handleBeforeUnload = () => {
      if (pendingSaveRef.current) {
        if (saveTimeoutRef.current) {
          clearTimeout(saveTimeoutRef.current)
        }
        saveDrawingSync(currentElementsRef.current, currentAppStateRef.current)
      }
    }

    window.addEventListener('beforeunload', handleBeforeUnload)

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
      }
    }
  }, [loadDrawing, saveDrawingSync])

  const handleChange = useCallback((elements: any, appState: any) => {
    currentElementsRef.current = elements
    currentAppStateRef.current = appState

    if (!hasLoadedRef.current) return

    const hadContent = lastSavedElementsRef.current && lastSavedElementsRef.current.length > 0
    if (elements.length === 0 && hadContent) {
      console.log('Skipping save: canvas reset detected')
      return
    }

    pendingSaveRef.current = true

    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)

    saveTimeoutRef.current = setTimeout(() => {
      try {
        const data = {
          elements,
          appState: {
            viewBackgroundColor: appState.viewBackgroundColor,
          },
        }
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
        lastSavedElementsRef.current = elements
        pendingSaveRef.current = false
        console.log('Saved', elements.length, 'elements')
      } catch (err) {
        console.error('Failed to save drawing:', err)
      }
    }, 1000)
  }, [])

  if (isLoading) return null

  return (
    <div className="excalidraw-canvas">
      <div className="canvas-content">
        <Excalidraw
          initialData={initialData || undefined}
          onChange={handleChange}
        />
      </div>
    </div>
  )
}

export default NoteEditor
