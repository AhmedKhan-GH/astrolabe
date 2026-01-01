import { useState, useEffect } from 'react'
import './App.css'

interface Record {
  id: number;
  timestamp: Date;
}

function App() {
  const [records, setRecords] = useState<Record[]>([])

  const loadRecords = async () => {
    try {
      const data = await window.electronAPI.records.getAll()
      setRecords(data)
    } catch (error) {
      console.error('Error loading records:', error)
    }
  }

  useEffect(() => {
    loadRecords()
  }, [])

  const handleRecordTimestamp = async () => {
    try {
      await window.electronAPI.records.create()
      loadRecords()
    } catch (error) {
      console.error('Error creating record:', error)
    }
  }

  return (
    <div style={{ 
      padding: '40px', 
      maxWidth: '600px', 
      margin: '0 auto',
      fontFamily: 'system-ui, -apple-system, sans-serif'
    }}>
      <h1 style={{ textAlign: 'center', marginBottom: '40px' }}>Timestamp Recorder</h1>

      <button 
        onClick={handleRecordTimestamp}
        style={{ 
          width: '100%',
          padding: '20px',
          fontSize: '18px',
          fontWeight: 'bold',
          backgroundColor: '#2196F3',
          color: 'white',
          border: 'none',
          borderRadius: '8px',
          cursor: 'pointer',
          marginBottom: '30px'
        }}
      >
        Record Timestamp
      </button>

      <div>
        <h2 style={{ marginBottom: '15px' }}>Records ({records.length})</h2>
        <div style={{ 
          maxHeight: '500px', 
          overflowY: 'auto',
          border: '1px solid #ddd',
          borderRadius: '8px'
        }}>
          {records.length === 0 ? (
            <div style={{ padding: '20px', textAlign: 'center', color: '#999' }}>
              No records yet. Click the button above to create one.
            </div>
          ) : (
            records.map(record => (
              <div key={record.id} style={{ 
                padding: '15px',
                borderBottom: '1px solid #eee',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }}>
                <span style={{ fontSize: '16px' }}>
                  {new Date(record.timestamp).toLocaleString()}
                </span>
                <span style={{ 
                  fontSize: '14px', 
                  color: '#666',
                  fontFamily: 'monospace'
                }}>
                  #{record.id}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

export default App
