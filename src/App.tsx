import './App.css'
import { useRecords } from './hooks/useRecords'
import { useState } from 'react'
import type { Record } from './db/schema'

function App() {
  const { records, loading, error, createRecord } = useRecords()
  const [searchTerm, setSearchTerm] = useState('')
  const [searchResults, setSearchResults] = useState<Record[] | null>(null)
  const [searching, setSearching] = useState(false)

  const handleRecordTimestamp = async () => {
    try {
      await createRecord()
    } catch (error) {
      // Error already logged in hook
    }
  }

  const handleSearch = async () => {
    if (!searchTerm.trim()) {
      setSearchResults(null)
      return
    }

    try {
      setSearching(true)
      const results = await window.electronAPI.searchRecordsByTitle(searchTerm)
      setSearchResults(results)
    } catch (err) {
      console.error('Search error:', err)
    } finally {
      setSearching(false)
    }
  }

  const handleClearSearch = () => {
    setSearchTerm('')
    setSearchResults(null)
  }

  const displayRecords = searchResults !== null ? searchResults : records

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

      {/* Search Section - Testing Custom Query */}
      <div style={{ 
        marginBottom: '30px',
        padding: '20px',
        backgroundColor: '#f5f5f5',
        borderRadius: '8px',
        border: '2px solid #4CAF50'
      }}>
        <h3 style={{ marginTop: 0, marginBottom: '15px', color: '#4CAF50' }}>
          🔍 Test Custom Query
        </h3>
        <div style={{ display: 'flex', gap: '10px', marginBottom: '10px' }}>
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
            placeholder="Search by title..."
            style={{
              flex: 1,
              padding: '12px',
              fontSize: '16px',
              border: '1px solid #ddd',
              borderRadius: '6px'
            }}
          />
          <button
            onClick={handleSearch}
            disabled={searching || !searchTerm.trim()}
            style={{
              padding: '12px 24px',
              fontSize: '16px',
              backgroundColor: searching ? '#81C784' : '#4CAF50',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              cursor: searching || !searchTerm.trim() ? 'not-allowed' : 'pointer',
              opacity: searching || !searchTerm.trim() ? 0.6 : 1
            }}
          >
            {searching ? 'Searching...' : 'Search'}
          </button>
          {searchResults !== null && (
            <button
              onClick={handleClearSearch}
              style={{
                padding: '12px 24px',
                fontSize: '16px',
                backgroundColor: '#757575',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer'
              }}
            >
              Clear
            </button>
          )}
        </div>
        {searchResults !== null && (
          <div style={{ fontSize: '14px', color: '#666' }}>
            Found {searchResults.length} result(s) for "{searchTerm}"
          </div>
        )}
      </div>

      <div>
        <h2 style={{ marginBottom: '15px' }}>
          {searchResults !== null ? 'Search Results' : `All Records (${records.length})`}
        </h2>
        <div style={{ 
          maxHeight: '500px', 
          overflowY: 'auto',
          border: '1px solid #ddd',
          borderRadius: '8px'
        }}>
          {displayRecords.length === 0 ? (
            <div style={{ padding: '20px', textAlign: 'center', color: '#999' }}>
              {searchResults !== null 
                ? 'No records found matching your search.'
                : 'No records yet. Click the button above to create one.'}
            </div>
          ) : (
            displayRecords.map(record => (
              <div key={record.id} style={{ 
                padding: '15px',
                borderBottom: '1px solid #eee',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '16px', fontWeight: 'bold', marginBottom: '4px' }}>
                    {record.title}
                  </div>
                  <div style={{ fontSize: '14px', color: '#666' }}>
                    {record.timestamp ? new Date(record.timestamp).toLocaleString() : 'N/A'}
                  </div>
                </div>
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
