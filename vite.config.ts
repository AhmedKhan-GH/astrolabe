import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { spawn } from 'node:child_process'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'electron-build',
      closeBundle() {
        // Build Electron main and preload scripts
        const electronBuild = spawn('tsc', ['-p', 'tsconfig.electron.json'], {
          shell: true,
          stdio: 'inherit'
        })

        electronBuild.on('close', (code) => {
          if (code === 0) {
            console.log('Electron TypeScript build completed')
          }
        })
      }
    }
  ],
  base: './',
  build: {
    outDir: 'dist'
  }
})
