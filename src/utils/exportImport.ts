import { getAllFiles } from './fileStorage'
import { getAllNotes, type StoredNote } from './noteStorage'

interface ExportData {
  version: string
  exportedAt: number
  workspaceName?: string
  files: Array<{
    id: string
    name: string
    size: number
    type: string
    data: string // base64
  }>
  notes: StoredNote[]
}

// Convert File to base64
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => {
      const base64 = (reader.result as string).split(',')[1]
      resolve(base64)
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

// Convert base64 to File
function base64ToFile(base64: string, filename: string, type: string): File {
  const byteString = atob(base64)
  const ab = new ArrayBuffer(byteString.length)
  const ia = new Uint8Array(ab)
  for (let i = 0; i < byteString.length; i++) {
    ia[i] = byteString.charCodeAt(i)
  }
  const blob = new Blob([ab], { type })
  return new File([blob], filename, { type })
}

// Export all data to JSON
export async function exportToJSON(workspaceName: string = 'New Workspace'): Promise<void> {
  try {
    const files = await getAllFiles()
    const notes = await getAllNotes()

    // Convert files to base64, preserving their unique IDs
    const filesData = await Promise.all(
      files.map(async (file: File & { uniqueId?: string }) => ({
        id: file.uniqueId || `${Date.now()}-${file.name}`,
        name: file.name,
        size: file.size,
        type: file.type,
        data: await fileToBase64(file)
      }))
    )

    const exportData: ExportData = {
      version: '1.0.0',
      exportedAt: Date.now(),
      workspaceName,
      files: filesData,
      notes: notes
    }

    const jsonString = JSON.stringify(exportData, null, 2)
    const blob = new Blob([jsonString], { type: 'application/json' })

    // Use workspace name as filename, default to 'workspace' if empty
    const sanitizedName = workspaceName.trim() || 'workspace'
    const filename = `${sanitizedName}.astro`

    // Trigger download
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  } catch (error) {
    console.error('Export failed:', error)
    throw new Error('Failed to export data')
  }
}

// Import data from JSON
export async function importFromJSON(file: File): Promise<string | undefined> {
  try {
    const text = await file.text()
    const data: ExportData = JSON.parse(text)

    if (!data.version || !data.files) {
      throw new Error('Invalid backup file format')
    }

    // Import using dynamic import to avoid circular dependency
    const { clearAllFiles } = await import('./fileStorage')
    const { saveNote, clearAllNotes } = await import('./noteStorage')

    // Clear existing files and notes
    await clearAllFiles()
    await clearAllNotes()

    // Restore files from base64 with their original IDs
    // We need to manually save to IndexedDB to preserve the file IDs
    const dbRequest = indexedDB.open('PDFViewerDB', 4)
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      dbRequest.onsuccess = () => resolve(dbRequest.result)
      dbRequest.onerror = () => reject(dbRequest.error)
    })

    for (const fileData of data.files) {
      const restoredFile = base64ToFile(fileData.data, fileData.name, fileData.type)

      // Store with the original ID if available (for backward compatibility)
      const fileId = fileData.id || `${Date.now()}-${fileData.name}`

      const storedFile = {
        id: fileId,
        name: fileData.name,
        size: fileData.size,
        type: fileData.type,
        blob: restoredFile,
        addedAt: Date.now()
      }

      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction(['files'], 'readwrite')
        const store = transaction.objectStore('files')
        const request = store.put(storedFile)
        request.onsuccess = () => resolve()
        request.onerror = () => reject(request.error)
      })
    }

    // Restore notes if they exist (backward compatibility with old exports)
    if (data.notes && Array.isArray(data.notes)) {
      for (const note of data.notes) {
        await saveNote(note)
      }
    }

    // Return workspace name if available
    return data.workspaceName
  } catch (error) {
    console.error('Import failed:', error)
    throw new Error('Failed to import data: ' + (error as Error).message)
  }
}
