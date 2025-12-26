const DB_NAME = 'PDFViewerDB'
const DB_VERSION = 4
const NOTES_STORE_NAME = 'notes'

export interface StoredNote {
  id: string
  fileId: string // Associate note with a specific file
  title: string
  tocPaths: string[] // Convert Set to Array for storage
  pageRanges: number[]
  createdAt: number
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result)

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result

      // Create files store if it doesn't exist
      if (!db.objectStoreNames.contains('files')) {
        db.createObjectStore('files', { keyPath: 'id' })
      }

      // Create notes store if it doesn't exist
      if (!db.objectStoreNames.contains(NOTES_STORE_NAME)) {
        const notesStore = db.createObjectStore(NOTES_STORE_NAME, { keyPath: 'id' })
        // Create index for querying by fileId
        notesStore.createIndex('fileId', 'fileId', { unique: false })
      }
    }
  })
}

export async function saveNote(note: StoredNote): Promise<void> {
  const db = await openDB()

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([NOTES_STORE_NAME], 'readwrite')
    const store = transaction.objectStore(NOTES_STORE_NAME)
    const request = store.put(note)

    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
}

export async function getNotesForFile(fileId: string): Promise<StoredNote[]> {
  const db = await openDB()

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([NOTES_STORE_NAME], 'readonly')
    const store = transaction.objectStore(NOTES_STORE_NAME)
    const index = store.index('fileId')
    const request = index.getAll(fileId)

    request.onsuccess = () => resolve(request.result as StoredNote[])
    request.onerror = () => reject(request.error)
  })
}

export async function deleteNote(noteId: string): Promise<void> {
  const db = await openDB()

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([NOTES_STORE_NAME], 'readwrite')
    const store = transaction.objectStore(NOTES_STORE_NAME)
    const request = store.delete(noteId)

    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
}

export async function getAllNotes(): Promise<StoredNote[]> {
  const db = await openDB()

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([NOTES_STORE_NAME], 'readonly')
    const store = transaction.objectStore(NOTES_STORE_NAME)
    const request = store.getAll()

    request.onsuccess = () => resolve(request.result as StoredNote[])
    request.onerror = () => reject(request.error)
  })
}

export async function clearAllNotes(): Promise<void> {
  const db = await openDB()

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([NOTES_STORE_NAME], 'readwrite')
    const store = transaction.objectStore(NOTES_STORE_NAME)
    const request = store.clear()

    request.onsuccess = () => {
      console.log('clearAllNotes: Successfully cleared all notes from IndexedDB')
      resolve()
    }
    request.onerror = () => {
      console.error('clearAllNotes: Failed to clear notes:', request.error)
      reject(request.error)
    }
  })
}
