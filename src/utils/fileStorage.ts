const DB_NAME = 'PDFViewerDB'
const DB_VERSION = 4
const STORE_NAME = 'files'
const NOTES_STORE_NAME = 'notes'

interface StoredFile {
  id: string
  name: string
  size: number
  type: string
  blob: Blob
  addedAt: number
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result)

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result

      // Create files store if it doesn't exist
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' })
      }

      // Create notes store if it doesn't exist
      if (!db.objectStoreNames.contains(NOTES_STORE_NAME)) {
        const notesStore = db.createObjectStore(NOTES_STORE_NAME, { keyPath: 'id' })
        notesStore.createIndex('fileId', 'fileId', { unique: false })
      }
    }
  })
}

export async function saveFile(file: File): Promise<string> {
  const db = await openDB()
  const id = `${Date.now()}-${file.name}`

  const storedFile: StoredFile = {
    id,
    name: file.name,
    size: file.size,
    type: file.type,
    blob: file,
    addedAt: Date.now()
  }

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite')
    const store = transaction.objectStore(STORE_NAME)
    const request = store.put(storedFile)

    request.onsuccess = () => resolve(id)
    request.onerror = () => reject(request.error)
  })
}

export async function getAllFiles(): Promise<File[]> {
  const db = await openDB()

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readonly')
    const store = transaction.objectStore(STORE_NAME)
    const request = store.getAll()

    request.onsuccess = () => {
      const storedFiles = request.result as StoredFile[]
      const files = storedFiles.map(sf => 
        new File([sf.blob], sf.name, { type: sf.type })
      )
      resolve(files)
    }
    request.onerror = () => reject(request.error)
  })
}

export async function deleteFile(fileName: string): Promise<void> {
  const db = await openDB()
  const allFiles = await getAllFilesWithIds()
  const fileToDelete = allFiles.find(f => f.name === fileName)

  if (!fileToDelete) return

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite')
    const store = transaction.objectStore(STORE_NAME)
    const request = store.delete(fileToDelete.id)

    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
}

async function getAllFilesWithIds(): Promise<StoredFile[]> {
  const db = await openDB()

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readonly')
    const store = transaction.objectStore(STORE_NAME)
    const request = store.getAll()

    request.onsuccess = () => resolve(request.result as StoredFile[])
    request.onerror = () => reject(request.error)
  })
}

export async function clearAllFiles(): Promise<void> {
  const db = await openDB()

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite')
    const store = transaction.objectStore(STORE_NAME)
    const request = store.clear()

    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
}
