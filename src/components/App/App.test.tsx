import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import App from './App'

vi.stubGlobal('window', {
    electronAPI: {
        getAllFiles: vi.fn().mockResolvedValue([]),
        getDataDirectory: vi.fn().mockResolvedValue(''),
    },
})

describe('App', () => {
    it('renders', () => {
        render(<App />)
        expect(screen.getByText('Astrolabe')).toBeTruthy()
    })
})