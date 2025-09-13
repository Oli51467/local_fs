const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('fsAPI', {
  // 文件树相关
  getFileTree: () => ipcRenderer.invoke('get-file-tree'),
  createFolder: (parentPath, folderName) => ipcRenderer.invoke('create-folder', parentPath, folderName),
  createFile: (parentPath, fileName) => ipcRenderer.invoke('create-file', parentPath, fileName),
  deleteItem: (itemPath) => ipcRenderer.invoke('delete-item', itemPath),
  renameItem: (itemPath, newName) => ipcRenderer.invoke('rename-item', itemPath, newName),
  moveItem: (sourcePath, targetPath) => ipcRenderer.invoke('move-item', sourcePath, targetPath),
  
  // 文件展示相关
  readFile: (filePath) => ipcRenderer.invoke('read-file', filePath),
  readFileBuffer: (filePath) => ipcRenderer.invoke('read-file-buffer', filePath),
  writeFile: (filePath, content) => ipcRenderer.invoke('write-file', filePath, content),
  getFileInfo: (filePath) => ipcRenderer.invoke('get-file-info', filePath),
  fileExists: (filePath) => ipcRenderer.invoke('file-exists', filePath),
  getFileMimeType: (filePath) => ipcRenderer.invoke('get-file-mime-type', filePath),
  isTextFile: (filePath) => ipcRenderer.invoke('is-text-file', filePath),
  isImageFile: (filePath) => ipcRenderer.invoke('is-image-file', filePath),
  isVideoFile: (filePath) => ipcRenderer.invoke('is-video-file', filePath),
  isAudioFile: (filePath) => ipcRenderer.invoke('is-audio-file', filePath),
  
  // PDF相关
  getPdfWorkerPath: () => ipcRenderer.invoke('get-pdf-worker-path'),
  
  // PPTX相关
  readPptxFile: (filePath) => ipcRenderer.invoke('read-pptx-file', filePath),
  
  // 设置相关
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  
  // 文件导入相关
  selectFiles: () => ipcRenderer.invoke('select-files'),
  importFiles: (targetPath, filePaths) => ipcRenderer.invoke('import-files', targetPath, filePaths)
});
