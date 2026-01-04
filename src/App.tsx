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
    <div style={{ padding: '20px' }}>
      <h1>Hello World</h1>
      <p>Simple React + Database Demo</p>

      <div style={{ marginBottom: '20px', padding: '10px', backgroundColor: '#f0f0f0', borderRadius: '5px' }}>
        <strong>Data Location:</strong> {dataPath}
        <br />
        <button onClick={changeDataLocation} style={{ marginTop: '10px' }}>
          Change Data Location (.astro file)
        </button>
      </div>

      <button onClick={addItem}>Add Item to DB</button>

      {message && <p>{message}</p>}

      <h2>Items in Database:</h2>
      <ul>
        {items.map(item => (
          <li key={item.id}>
            ID: {item.id} - {item.filename}
          </li>
        ))}
      </ul>
    </div>
  )
}

export default App
