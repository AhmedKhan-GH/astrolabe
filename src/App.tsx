import { useState, useEffect } from 'react'

function App() {
  const [message, setMessage] = useState('')
  const [items, setItems] = useState<Array<{ id: number; filename: string }>>([])

  // Load items from database on mount
  useEffect(() => {
    window.electronAPI.getAllFiles().then(setItems)
  }, [])

  // Add a new item to database
  const addItem = async () => {
    const filename = `item-${Date.now()}`
    await window.electronAPI.selectAndUploadFiles()
    const updated = await window.electronAPI.getAllFiles()
    setItems(updated)
    setMessage(`Added: ${filename}`)
  }

  return (
    <div style={{ padding: '20px' }}>
      <h1>Hello World</h1>
      <p>Simple React + Database Demo</p>

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
