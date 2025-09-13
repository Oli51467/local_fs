// 文件展示模块 - 主进程逻辑
const { ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');

class FileViewerModule {
  constructor() {
    this.initializeIpcHandlers();
  }

  // 初始化IPC处理器
  initializeIpcHandlers() {
    // 读取文件内容（文本格式）
    ipcMain.handle('read-file', (event, filePath) => {
      try {
        return fs.readFileSync(filePath, 'utf-8');
      } catch (error) {
        console.error('读取文件失败:', error);
        throw new Error(`读取文件失败: ${error.message}`);
      }
    });

    // 读取文件为Buffer（二进制格式）
    ipcMain.handle('read-file-buffer', (event, filePath) => {
      try {
        return fs.readFileSync(filePath);
      } catch (error) {
        console.error('读取文件Buffer失败:', error);
        throw new Error(`读取文件Buffer失败: ${error.message}`);
      }
    });

    // 写入文件内容
    ipcMain.handle('write-file', (event, filePath, content) => {
      try {
        fs.writeFileSync(filePath, content, 'utf-8');
        return { success: true };
      } catch (error) {
        console.error('写文件失败:', error);
        return { success: false, error: error.message };
      }
    });

    // 获取文件信息
    ipcMain.handle('get-file-info', (event, filePath) => {
      try {
        const stats = fs.statSync(filePath);
        return {
          success: true,
          info: {
            size: stats.size,
            isFile: stats.isFile(),
            isDirectory: stats.isDirectory(),
            mtime: stats.mtime,
            ctime: stats.ctime,
            extension: path.extname(filePath).toLowerCase()
          }
        };
      } catch (error) {
        console.error('获取文件信息失败:', error);
        return { success: false, error: error.message };
      }
    });

    // 检查文件是否存在
    ipcMain.handle('file-exists', (event, filePath) => {
      try {
        return fs.existsSync(filePath);
      } catch (error) {
        console.error('检查文件存在性失败:', error);
        return false;
      }
    });

    // 获取文件MIME类型（基于扩展名）
    ipcMain.handle('get-file-mime-type', (event, filePath) => {
      const ext = path.extname(filePath).toLowerCase();
      const mimeTypes = {
        '.txt': 'text/plain',
        '.md': 'text/markdown',
        '.js': 'text/javascript',
        '.json': 'application/json',
        '.html': 'text/html',
        '.css': 'text/css',
        '.xml': 'text/xml',
        '.pdf': 'application/pdf',
        '.doc': 'application/msword',
        '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        '.xls': 'application/vnd.ms-excel',
        '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        '.ppt': 'application/vnd.ms-powerpoint',
        '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        '.zip': 'application/zip',
        '.rar': 'application/x-rar-compressed',
        '.7z': 'application/x-7z-compressed',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.svg': 'image/svg+xml',
        '.bmp': 'image/bmp',
        '.webp': 'image/webp',
        '.mp3': 'audio/mpeg',
        '.wav': 'audio/wav',
        '.mp4': 'video/mp4',
        '.avi': 'video/x-msvideo',
        '.mov': 'video/quicktime'
      };
      
      return mimeTypes[ext] || 'application/octet-stream';
    });

    // 判断文件是否为文本文件
    ipcMain.handle('is-text-file', (event, filePath) => {
      const mimeType = this.getFileMimeType(filePath);
      return mimeType.startsWith('text/') || 
             mimeType === 'application/json' || 
             mimeType === 'application/xml';
    });

    // 判断文件是否为图片文件
    ipcMain.handle('is-image-file', (event, filePath) => {
      const mimeType = this.getFileMimeType(filePath);
      return mimeType.startsWith('image/');
    });

    // 判断文件是否为视频文件
    ipcMain.handle('is-video-file', (event, filePath) => {
      const mimeType = this.getFileMimeType(filePath);
      return mimeType.startsWith('video/');
    });

    // 判断文件是否为音频文件
    ipcMain.handle('is-audio-file', (event, filePath) => {
      const mimeType = this.getFileMimeType(filePath);
      return mimeType.startsWith('audio/');
    });

    // PDF Worker路径
    ipcMain.handle('get-pdf-worker-path', () => {
      const workerPath = path.join(__dirname, '..', '..', 'static', 'libs', 'pdf.worker.min.js');
      return 'file://' + workerPath.replace(/\\/g, '/');
    });

    // PPTX文件读取
    ipcMain.handle('read-pptx-file', async (event, filePath) => {
      try {
        const buffer = fs.readFileSync(filePath);
        return {
          success: true,
          buffer: buffer,
          fileName: path.basename(filePath)
        };
      } catch (error) {
        console.error('读取PPTX文件失败:', error);
        return {
          success: false,
          error: error.message
        };
      }
    });
  }

  // 获取文件MIME类型的内部方法
  getFileMimeType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes = {
      '.txt': 'text/plain',
      '.md': 'text/markdown',
      '.js': 'text/javascript',
      '.json': 'application/json',
      '.html': 'text/html',
      '.css': 'text/css',
      '.xml': 'text/xml',
      '.pdf': 'application/pdf',
      '.doc': 'application/msword',
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.xls': 'application/vnd.ms-excel',
      '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      '.ppt': 'application/vnd.ms-powerpoint',
      '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      '.zip': 'application/zip',
      '.rar': 'application/x-rar-compressed',
      '.7z': 'application/x-7z-compressed',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.svg': 'image/svg+xml',
      '.bmp': 'image/bmp',
      '.webp': 'image/webp',
      '.mp3': 'audio/mpeg',
      '.wav': 'audio/wav',
      '.mp4': 'video/mp4',
      '.avi': 'video/x-msvideo',
      '.mov': 'video/quicktime'
    };
    
    return mimeTypes[ext] || 'application/octet-stream';
  }
}

module.exports = FileViewerModule;