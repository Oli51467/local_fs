const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('fsAPI', {
  getFileTree: () => ipcRenderer.invoke('get-file-tree'),
  readFile: (filePath) => ipcRenderer.invoke('read-file', filePath),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  getSettings: () => ipcRenderer.invoke('get-settings')
});
