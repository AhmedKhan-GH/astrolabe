import { useState, useEffect } from 'react'
import './App.css'

interface User {
  id: number;
  name: string;
  email: string;
  createdAt: Date;
}

interface Note {
  id: number;
  title: string;
  content: string | null;
  userId: number | null;
  createdAt: Date;
  updatedAt: Date;
}

function App() {
  const [users, setUsers] = useState<User[]>([])
  const [notes, setNotes] = useState<Note[]>([])
  const [newUserName, setNewUserName] = useState('')
  const [newUserEmail, setNewUserEmail] = useState('')
  const [newNoteTitle, setNewNoteTitle] = useState('')
  const [newNoteContent, setNewNoteContent] = useState('')
  const [selectedUserId, setSelectedUserId] = useState<number | undefined>()
  const [message, setMessage] = useState('')

  const loadData = async () => {
    try {
      const [usersData, notesData] = await Promise.all([
        window.electronAPI.users.getAll(),
        window.electronAPI.notes.getAll()
      ])
      setUsers(usersData)
      setNotes(notesData)
      setMessage('Data loaded successfully!')
    } catch (error) {
      setMessage(`Error loading data: ${error}`)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  const handleCreateUser = async () => {
    if (!newUserName || !newUserEmail) {
      setMessage('Please fill in all user fields')
      return
    }
    try {
      await window.electronAPI.users.create({
        name: newUserName,
        email: newUserEmail
      })
      setNewUserName('')
      setNewUserEmail('')
      setMessage('User created successfully!')
      loadData()
    } catch (error) {
      setMessage(`Error creating user: ${error}`)
    }
  }

  const handleCreateNote = async () => {
    if (!newNoteTitle) {
      setMessage('Please enter a note title')
      return
    }
    try {
      await window.electronAPI.notes.create({
        title: newNoteTitle,
        content: newNoteContent || undefined,
        userId: selectedUserId
      })
      setNewNoteTitle('')
      setNewNoteContent('')
      setMessage('Note created successfully!')
      loadData()
    } catch (error) {
      setMessage(`Error creating note: ${error}`)
    }
  }

  const handleDeleteUser = async (id: number) => {
    try {
      await window.electronAPI.users.delete(id)
      setMessage('User deleted successfully!')
      loadData()
    } catch (error) {
      setMessage(`Error deleting user: ${error}`)
    }
  }

  const handleDeleteNote = async (id: number) => {
    try {
      await window.electronAPI.notes.delete(id)
      setMessage('Note deleted successfully!')
      loadData()
    } catch (error) {
      setMessage(`Error deleting note: ${error}`)
    }
  }

  return (
    <div style={{ padding: '20px', maxWidth: '1200px', margin: '0 auto' }}>
      <h1>Astrolabe - Database Test</h1>

      {message && (
        <div style={{ 
          padding: '10px', 
          marginBottom: '20px', 
          backgroundColor: message.includes('Error') ? '#ffebee' : '#e8f5e9',
          borderRadius: '4px'
        }}>
          {message}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '30px' }}>
        {/* Create User Section */}
        <div style={{ border: '1px solid #ccc', padding: '15px', borderRadius: '8px' }}>
          <h2>Create User</h2>
          <input
            type="text"
            placeholder="Name"
            value={newUserName}
            onChange={(e) => setNewUserName(e.target.value)}
            style={{ width: '100%', padding: '8px', marginBottom: '10px' }}
          />
          <input
            type="email"
            placeholder="Email"
            value={newUserEmail}
            onChange={(e) => setNewUserEmail(e.target.value)}
            style={{ width: '100%', padding: '8px', marginBottom: '10px' }}
          />
          <button onClick={handleCreateUser} style={{ width: '100%', padding: '10px' }}>
            Create User
          </button>
        </div>

        {/* Create Note Section */}
        <div style={{ border: '1px solid #ccc', padding: '15px', borderRadius: '8px' }}>
          <h2>Create Note</h2>
          <input
            type="text"
            placeholder="Title"
            value={newNoteTitle}
            onChange={(e) => setNewNoteTitle(e.target.value)}
            style={{ width: '100%', padding: '8px', marginBottom: '10px' }}
          />
          <textarea
            placeholder="Content (optional)"
            value={newNoteContent}
            onChange={(e) => setNewNoteContent(e.target.value)}
            style={{ width: '100%', padding: '8px', marginBottom: '10px', minHeight: '60px' }}
          />
          <select
            value={selectedUserId || ''}
            onChange={(e) => setSelectedUserId(e.target.value ? Number(e.target.value) : undefined)}
            style={{ width: '100%', padding: '8px', marginBottom: '10px' }}
          >
            <option value="">No User</option>
            {users.map(user => (
              <option key={user.id} value={user.id}>{user.name}</option>
            ))}
          </select>
          <button onClick={handleCreateNote} style={{ width: '100%', padding: '10px' }}>
            Create Note
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
        {/* Users List */}
        <div>
          <h2>Users ({users.length})</h2>
          <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
            {users.map(user => (
              <div key={user.id} style={{ 
                border: '1px solid #ddd', 
                padding: '10px', 
                marginBottom: '10px',
                borderRadius: '4px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }}>
                <div>
                  <strong>{user.name}</strong>
                  <br />
                  <small>{user.email}</small>
                </div>
                <button 
                  onClick={() => handleDeleteUser(user.id)}
                  style={{ padding: '5px 10px', backgroundColor: '#f44336', color: 'white' }}
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Notes List */}
        <div>
          <h2>Notes ({notes.length})</h2>
          <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
            {notes.map(note => (
              <div key={note.id} style={{ 
                border: '1px solid #ddd', 
                padding: '10px', 
                marginBottom: '10px',
                borderRadius: '4px'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                  <div style={{ flex: 1 }}>
                    <strong>{note.title}</strong>
                    {note.content && <p style={{ margin: '5px 0' }}>{note.content}</p>}
                    <small>
                      User ID: {note.userId || 'None'}
                    </small>
                  </div>
                  <button 
                    onClick={() => handleDeleteNote(note.id)}
                    style={{ padding: '5px 10px', backgroundColor: '#f44336', color: 'white' }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <button 
        onClick={loadData} 
        style={{ 
          marginTop: '20px', 
          padding: '10px 20px',
          width: '100%',
          backgroundColor: '#2196F3',
          color: 'white'
        }}
      >
        Refresh Data
      </button>
    </div>
  )
}

export default App
