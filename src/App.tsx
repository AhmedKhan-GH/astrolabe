import './App.css'
import { useRecords } from './hooks/useRecords'

function App() {
  const { records, loading, error, createRecord } = useRecords()

  const handleRecordTimestamp = async () => {
    try {
      await createRecord()
    } catch (error) {
      // Error already logged in hook
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

      {error && (
        <div style={{
          padding: '15px',
          marginBottom: '20px',
          backgroundColor: '#ffebee',
          color: '#c62828',
          borderRadius: '8px',
          border: '1px solid #ef9a9a'
        }}>
          Error: {error.message}
        </div>
      )}

      <button 
        onClick={handleRecordTimestamp}
        disabled={loading}
        style={{ 
          width: '100%',
          padding: '20px',
          fontSize: '18px',
          fontWeight: 'bold',
          backgroundColor: loading ? '#90caf9' : '#2196F3',
          color: 'white',
          border: 'none',
          borderRadius: '8px',
          cursor: loading ? 'not-allowed' : 'pointer',
          marginBottom: '30px',
          opacity: loading ? 0.7 : 1
        }}
      >
        {loading ? 'Loading...' : 'Record Timestamp'}
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
