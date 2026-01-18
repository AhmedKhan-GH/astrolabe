import { useState, useEffect } from 'react'

function App() {
  const [message, setMessage] = useState('')
  const [items, setItems] = useState<Array<{ id: number; filename: string }>>([])
  const [dataPath, setDataPath] = useState('')

  // Load items from database on mount
  useEffect(() => {
    window.electronAPI.getAllFiles().then(setItems)
    window.electronAPI.getDataDirectory().then(setDataPath)
  }, [])

  // Add a new item to database
  const addItem = async () => {
    const filename = `item-${Date.now()}`
    await window.electronAPI.selectAndUploadFiles()
    const updated = await window.electronAPI.getAllFiles()
    setItems(updated)
    setMessage(`Added: ${filename}`)
  }

  const changeDataLocation = async () => {
    const newPath = await window.electronAPI.chooseDataDirectory()
    if (newPath) {
      setDataPath(newPath)
      setMessage(`Data location changed to: ${newPath}`)
      // Note: You'll need to restart the app for this to take effect
      setMessage(`Data location will be: ${newPath} (restart app to apply)`)
    }
  }

  return (
    <div className="h-screen bg-slate-900 flex flex-col">
      <div className="flex gap-2 p-2 bg-slate-800 border-b border-slate-700">
        <div className="bg-slate-700 px-3 py-1 border border-slate-600 hover:bg-slate-600 hover:scale-105 hover:rounded-lg active:scale-95 transition cursor-pointer">
          <h1 className="text-sm text-white">Astrolabe</h1>
        </div>
        <button onClick={addItem} className="px-3 py-1 text-xs bg-indigo-600 text-white hover:bg-indigo-700 hover:scale-105 hover:rounded-lg active:scale-95 transition">
          Add Item
        </button>
        <button onClick={changeDataLocation} className="px-3 py-1 text-xs bg-purple-600 text-white hover:bg-purple-700 hover:scale-105 hover:rounded-lg active:scale-95 transition">
          Change Location
        </button>
        <div className="ml-auto text-xs text-gray-400">{dataPath}</div>
      </div>

      {message && <div className="bg-green-900/30 p-2 mx-2 mt-2"><p className="text-xs text-green-300">{message}</p></div>}

      <div className="flex-1 overflow-auto p-3">
        <div className="bg-slate-800 p-3 border border-slate-700 h-full">
          <div className="flex justify-between mb-3">
            <h2 className="text-sm text-white">Items</h2>
            <span className="text-xs text-gray-300">{items.length}</span>
          </div>
          {items.length === 0 ? (
            <p className="text-xs text-gray-500">No items</p>
          ) : (
            <ul>
              {items.map(item => (
                <li key={item.id} className="flex gap-2 p-2 border-b border-slate-700">
                  <div className="w-6 h-6 bg-purple-600 flex items-center justify-center">
                    <span className="text-xs text-white">{item.id}</span>
                  </div>
                  <p className="text-xs text-gray-300">{item.filename}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}

export default App
