import { getAllFiles } from './fileStorage'

interface ExportData {
  version: string
  exportedAt: number
  workspaceName?: string
  files: Array<{
    name: string
    size: number
    type: string
    data: string // base64
  }>
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

    // Convert files to base64
    const filesData = await Promise.all(
      files.map(async (file) => ({
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
      files: filesData
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
    const { saveFile, clearAllFiles } = await import('./fileStorage')

    // Clear existing files
    await clearAllFiles()

    // Restore files from base64
    for (const fileData of data.files) {
      const restoredFile = base64ToFile(fileData.data, fileData.name, fileData.type)
      await saveFile(restoredFile)
    }

    // Return workspace name if available
    return data.workspaceName
  } catch (error) {
    console.error('Import failed:', error)
    throw new Error('Failed to import data: ' + (error as Error).message)
  }
}
