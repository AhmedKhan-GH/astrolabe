// Preload script for Electron
// This script runs in the renderer process before the web page is loaded
// It can expose selected Node.js APIs to the renderer process

import { contextBridge } from 'electron';

// Expose protected methods that allow the renderer process to use
// ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electron', {
  // Add any APIs you want to expose to the renderer process here
});
