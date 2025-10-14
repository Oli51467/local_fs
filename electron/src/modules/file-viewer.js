// 文件展示模块 - 主进程逻辑
const { ipcMain, app } = require('electron');
const fs = require('fs');
const path = require('path');

const ELECTRON_ROOT = path.join(__dirname, '..', '..');
const STATIC_DEV_ROOT = path.join(ELECTRON_ROOT, 'static');

const toFileUrl = (absolutePath) => 'file://' + absolutePath.replace(/\\/g, '/');

const decodeFileUrl = (input) => {
  if (typeof input !== 'string') {
    return input;
  }
  if (!input.startsWith('file://')) {
    return input;
  }
  try {
    const url = new URL(input);
    let pathname = url.pathname || '';
    if (process.platform === 'win32' && pathname.startsWith('/')) {
      pathname = pathname.slice(1);
    }
    return decodeURIComponent(pathname);
  } catch (error) {
    return input.replace(/^file:\/\//i, '');
  }
};

const normalizePathString = (input) => {
  if (typeof input !== 'string') {
    return '';
  }
  return input.replace(/\\/g, '/');
};

const uniquePush = (collection, value, seen) => {
  if (!value) {
    return;
  }
  const normalized = path.normalize(value);
  if (seen.has(normalized)) {
    return;
  }
  seen.add(normalized);
  collection.push(normalized);
};

const isWindows = process.platform === 'win32';

const ensureWithinBase = (targetPath, basePath) => {
  const resolvedTarget = path.resolve(targetPath);
  const resolvedBase = path.resolve(basePath);
  const lhs = isWindows ? resolvedTarget.toLowerCase() : resolvedTarget;
  const rhs = isWindows ? resolvedBase.toLowerCase() : resolvedBase;
  if (!lhs.startsWith(rhs)) {
    throw new Error(`Invalid resource path requested: ${targetPath}`);
  }
};

const sanitizeRelativePath = (relativePath) => {
  if (typeof relativePath !== 'string') {
    throw new TypeError('relativePath must be a string');
  }
  const normalized = path.normalize(relativePath).replace(/^([/\\])+/g, '');
  if (!normalized) {
    throw new Error('relativePath cannot be empty');
  }
  return normalized;
};

const resolveStaticAsset = (...segments) => {
  const relativePath = sanitizeRelativePath(path.join(...segments));
  const baseDir = app.isPackaged ? path.join(process.resourcesPath, 'static') : STATIC_DEV_ROOT;
  const absolutePath = path.resolve(baseDir, relativePath);
  ensureWithinBase(absolutePath, baseDir);
  return absolutePath;
};

const resolveDistAsset = (relativePath) => {
  const sanitized = sanitizeRelativePath(relativePath);
  const baseDir = app.isPackaged ? process.resourcesPath : ELECTRON_ROOT;
  const absolutePath = path.resolve(baseDir, sanitized);
  ensureWithinBase(absolutePath, baseDir);
  return absolutePath;
};

class FileViewerModule {
  constructor() {
    this.runtimePaths = this.loadRuntimePaths();
    this.initializeIpcHandlers();
  }

  loadRuntimePaths() {
    const resolveEnvPath = (key) => {
      const value = process.env[key];
      if (!value) {
        return null;
      }
      try {
        return path.resolve(value);
      } catch (error) {
        return null;
      }
    };

    return {
      externalRoot: resolveEnvPath('FS_APP_EXTERNAL_ROOT'),
      dataRoot: resolveEnvPath('FS_APP_DATA_DIR'),
      metaRoot: resolveEnvPath('FS_APP_META_DIR')
    };
  }

  resolveMarkdownAssetPath(baseFilePath, rawAssetPath) {
    if (!rawAssetPath || typeof rawAssetPath !== 'string') {
      return null;
    }

    let asset = normalizePathString(rawAssetPath.trim());
    if (!asset) {
      return null;
    }

    if (/^(https?:|data:|blob:|mailto:|javascript:)/i.test(asset)) {
      return asset;
    }

    asset = normalizePathString(decodeFileUrl(asset));
    if (!asset) {
      return null;
    }
    const candidates = [];
    const seen = new Set();

    const pushCandidate = (candidate) => uniquePush(candidates, candidate, seen);

    const pushRuntimeRelative = (relativePath) => {
      if (!relativePath) {
        return;
      }
      const trimmed = normalizePathString(relativePath).replace(/^([/\\])+/, '');
      if (!trimmed) {
        return;
      }
      const { externalRoot, dataRoot, metaRoot } = this.runtimePaths || {};
      if (externalRoot) {
        pushCandidate(path.resolve(externalRoot, trimmed));
      }
      if (dataRoot) {
        pushCandidate(path.resolve(dataRoot, trimmed));
      }
      if (metaRoot) {
        pushCandidate(path.resolve(metaRoot, trimmed));
      }
    };

    const isAbsoluteAsset = path.isAbsolute(asset);
    if (isAbsoluteAsset) {
      pushCandidate(asset);
    } else if (asset.startsWith('/')) {
      pushRuntimeRelative(asset);
    }

    const resolvedBaseDir = typeof baseFilePath === 'string' && baseFilePath
      ? path.resolve(path.dirname(baseFilePath))
      : null;

    if (resolvedBaseDir) {
      pushCandidate(path.resolve(resolvedBaseDir, asset));
    }

    if (!isAbsoluteAsset && !asset.startsWith('/')) {
      pushRuntimeRelative(asset);
    }

    const assetFileName = path.basename(asset);
    const assetHasSubdirectory = asset.includes('/') || asset.includes('\\');
    if (assetFileName && !assetHasSubdirectory) {
      if (resolvedBaseDir) {
        pushCandidate(path.resolve(resolvedBaseDir, assetFileName));
      }
      const { externalRoot, dataRoot } = this.runtimePaths || {};
      if (dataRoot) {
        pushCandidate(path.resolve(dataRoot, assetFileName));
      }
      if (externalRoot) {
        pushCandidate(path.resolve(externalRoot, assetFileName));
      }
    }

    for (const candidate of candidates) {
      try {
        if (fs.existsSync(candidate)) {
          return candidate;
        }
      } catch (error) {
        // ignore access errors for individual candidates
      }
    }

    if (candidates.length > 0) {
      return candidates[0];
    }

    if (isAbsoluteAsset) {
      return asset;
    }

    return resolvedBaseDir ? path.resolve(resolvedBaseDir, asset) : asset;
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

    // PDF.js 资源路径
    ipcMain.handle('get-pdf-lib-path', () => {
      const libPath = resolveStaticAsset('libs', 'pdf.js');
      return toFileUrl(libPath);
    });

    // PDF Worker路径
    ipcMain.handle('get-pdf-worker-path', () => {
      const workerPath = resolveStaticAsset('libs', 'pdf.worker.min.js');
      return toFileUrl(workerPath);
    });

    ipcMain.handle('get-docx-lib-path', () => {
      const libPath = resolveStaticAsset('libs', 'docx-preview.js');
      return toFileUrl(libPath);
    });

    ipcMain.handle('get-jszip-lib-path', () => {
      const libPath = resolveStaticAsset('libs', 'jszip.min.js');
      return toFileUrl(libPath);
    });

    ipcMain.handle('get-pptx-lib-path', () => {
      const libPath = resolveStaticAsset('libs', 'pptx-preview.umd.js');
      return toFileUrl(libPath);
    });

    ipcMain.on('resolve-markdown-asset-sync', (event, payload) => {
      try {
        const { filePath, assetPath } = payload || {};
        event.returnValue = this.resolveMarkdownAssetPath(filePath, assetPath);
      } catch (error) {
        console.error('解析Markdown资源路径失败:', error);
        event.returnValue = null;
      }
    });

    ipcMain.handle('get-dist-asset-path', (event, relativePath) => {
      const assetPath = resolveDistAsset(relativePath);
      return toFileUrl(assetPath);
    });

    ipcMain.on('get-dist-asset-path-sync', (event, relativePath) => {
      try {
        const assetPath = resolveDistAsset(relativePath);
        event.returnValue = toFileUrl(assetPath);
      } catch (error) {
        event.returnValue = '';
      }
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
