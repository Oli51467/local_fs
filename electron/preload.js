const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('fsAPI', {
  // 文件树相关
  getFileTree: () => ipcRenderer.invoke('get-file-tree'),
  createFolder: (parentPath, folderName) => ipcRenderer.invoke('create-folder', parentPath, folderName),
  createFile: (parentPath, fileName) => ipcRenderer.invoke('create-file', parentPath, fileName),
  deleteItem: (itemPath) => ipcRenderer.invoke('delete-item', itemPath),
  renameItem: (itemPath, newName) => ipcRenderer.invoke('rename-item', itemPath, newName),
  moveItem: (sourcePath, targetPath) => ipcRenderer.invoke('move-item', sourcePath, targetPath),
  copyItemToClipboard: (itemPath) => ipcRenderer.invoke('copy-item-to-clipboard', itemPath),
  compressItem: (itemPath) => ipcRenderer.invoke('compress-item', itemPath),
  extractZip: (zipPath) => ipcRenderer.invoke('extract-zip', zipPath),
  pasteFromClipboard: (targetPath) => ipcRenderer.invoke('paste-from-clipboard', targetPath),
  
  // 文件展示相关
  readFile: (filePath) => ipcRenderer.invoke('read-file', filePath),
  readFileBuffer: (filePath) => ipcRenderer.invoke('read-file-buffer', filePath),
  writeFile: (filePath, content) => ipcRenderer.invoke('write-file', filePath, content),
  saveFile: (options) => ipcRenderer.invoke('save-file', options),
  getFileInfo: (filePath) => ipcRenderer.invoke('get-file-info', filePath),
  fileExists: (filePath) => ipcRenderer.invoke('file-exists', filePath),
  getFileMimeType: (filePath) => ipcRenderer.invoke('get-file-mime-type', filePath),
  isTextFile: (filePath) => ipcRenderer.invoke('is-text-file', filePath),
  isImageFile: (filePath) => ipcRenderer.invoke('is-image-file', filePath),
  isVideoFile: (filePath) => ipcRenderer.invoke('is-video-file', filePath),
  isAudioFile: (filePath) => ipcRenderer.invoke('is-audio-file', filePath),
  
  // PDF相关
  getPdfLibPath: () => ipcRenderer.invoke('get-pdf-lib-path'),
  getPdfWorkerPath: () => ipcRenderer.invoke('get-pdf-worker-path'),

  // Word / PPT 相关依赖
  getDocxLibPath: () => ipcRenderer.invoke('get-docx-lib-path'),
  getJsZipLibPath: () => ipcRenderer.invoke('get-jszip-lib-path'),
  getPptxLibPath: () => ipcRenderer.invoke('get-pptx-lib-path'),

  // 应用资源路径解析
  getAssetPath: (relativePath) => ipcRenderer.invoke('get-dist-asset-path', relativePath),
  getAssetPathSync: (relativePath) => ipcRenderer.sendSync('get-dist-asset-path-sync', relativePath),
  
  // 项目路径与运行时信息
  getRuntimePaths: () => ipcRenderer.invoke('fs-app:get-runtime-paths'),
  getRuntimePathsSync: () => ipcRenderer.sendSync('fs-app:get-runtime-paths-sync'),
  resolveProjectPath: (targetPath) => ipcRenderer.invoke('fs-app:resolve-project-path', targetPath),
  resolveProjectPathSync: (targetPath) => ipcRenderer.sendSync('fs-app:resolve-project-path-sync', targetPath),
  toProjectRelativePath: (targetPath) => ipcRenderer.invoke('fs-app:project-relative-path', targetPath),
  toProjectRelativePathSync: (targetPath) => ipcRenderer.sendSync('fs-app:project-relative-path-sync', targetPath),
  resolveMarkdownAssetPathSync: (filePath, assetPath) => ipcRenderer.sendSync('resolve-markdown-asset-sync', { filePath, assetPath }),
  
  // PPTX相关
  readPptxFile: (filePath) => ipcRenderer.invoke('read-pptx-file', filePath),

  // Excel（XLSX/XLS）相关
  readXlsxFile: (filePath) => ipcRenderer.invoke('read-xlsx-file', filePath),
  saveXlsxFile: (payload) => ipcRenderer.invoke('save-xlsx-file', payload),
  
  // 设置相关
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  onSettingsUpdated: (callback) => ipcRenderer.on('settings-updated', (event, config) => callback(config)),
  
  // 文件导入相关
  selectFiles: () => ipcRenderer.invoke('select-files'),
  importFiles: (targetPath, filePaths) => ipcRenderer.invoke('import-files', targetPath, filePaths)
});
