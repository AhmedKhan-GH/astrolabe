import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import App from './App'

const mockElectronAPI = {
  getAllFiles: vi.fn(),
  getDataDirectory: vi.fn(),
  selectAndUploadFiles: vi.fn(),
  chooseDataDirectory: vi.fn(),
}

beforeEach(() => {
  global.window.electronAPI = mockElectronAPI
  mockElectronAPI.getAllFiles.mockResolvedValue([])
  mockElectronAPI.getDataDirectory.mockResolvedValue('/test/path')
})

describe('App', () => {
  it('should render', () => {
    render(<App />)
    expect(screen.getByText('Astrolabe')).toBeInTheDocument()
  })
})
