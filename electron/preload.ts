import { contextBridge } from 'electron';

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electron', {
  // Add your API methods here
  // Example:
  // send: (channel: string, data: any) => {
  //   ipcRenderer.send(channel, data);
  // },
  // receive: (channel: string, func: (...args: any[]) => void) => {
  //   ipcRenderer.on(channel, (event, ...args) => func(...args));
  // }
});
