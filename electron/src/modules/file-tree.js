// 文件树模块 - 主进程逻辑
const { ipcMain, clipboard } = require('electron');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { execFile, execFileSync } = require('child_process');
const os = require('os');

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function escapeAppleScriptLiteral(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function setMacOSClipboardFiles(paths) {
  if (!Array.isArray(paths) || paths.length === 0) {
    return;
  }
  const items = paths.map((p) => `POSIX file "${escapeAppleScriptLiteral(p)}"`).join(', ');
  const script = paths.length === 1
    ? `set the clipboard to (${items})`
    : `set the clipboard to {${items}}`;
  try {
    execFileSync('osascript', ['-e', script], { stdio: 'ignore' });
  } catch (error) {
    console.warn('设置系统剪贴板失败 (osascript):', error);
  }
}

function toFileUrl(targetPath) {
  let normalized = path.resolve(targetPath);
  if (process.platform === 'win32') {
    normalized = normalized.replace(/\\/g, '/');
    if (!normalized.startsWith('/')) {
      normalized = `/${normalized}`;
    }
  }
  return `file://${encodeURI(normalized.replace(/\\/g, '/'))}`;
}

function writePathsToClipboard(paths) {
  if (!Array.isArray(paths) || paths.length === 0) {
    throw new Error('没有可复制的路径');
  }
  const normalizedPaths = paths.map((item) => path.resolve(item));
  const fallbackText = normalizedPaths.join(os.EOL);
  const fileUrls = normalizedPaths.map((p) => toFileUrl(p));
  const uriListBuffer = Buffer.from(`${fileUrls.join('\n')}\n`, 'utf8');
  let writeError = null;
  try {
    if (process.platform === 'win32') {
      const headerSize = 20;
      const joined = `${normalizedPaths.join('\0')}\0\0`;
      const dataBuffer = Buffer.from(joined, 'utf16le');
      const buffer = Buffer.alloc(headerSize + dataBuffer.length);
      // DROPFILES structure
      buffer.writeUInt32LE(headerSize, 0); // pFiles offset
      buffer.writeInt32LE(0, 4); // pt.x
      buffer.writeInt32LE(0, 8); // pt.y
      buffer.writeUInt32LE(0, 12); // fNC = FALSE
      buffer.writeUInt32LE(1, 16); // fWide = TRUE
      dataBuffer.copy(buffer, headerSize);
      clipboard.writeBuffer('CF_HDROP', buffer);
      if (normalizedPaths.length === 1) {
        const singlePath = normalizedPaths[0];
        clipboard.writeBuffer('FileNameW', Buffer.from(`${singlePath}\0`, 'utf16le'));
        clipboard.writeBuffer('FileName', Buffer.from(`${singlePath}\0`, 'utf8'));
        try {
          clipboard.writeBookmark(path.basename(singlePath), fileUrls[0]);
        } catch (bookmarkError) {
          // ignore bookmark write errors
        }
      }
    } else if (process.platform === 'darwin') {
      clipboard.writeBuffer('public.file-url', uriListBuffer);
      const plist = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
        '<plist version="1.0">',
        '<array>',
        ...normalizedPaths.map((p) => `  <string>${escapeXml(p)}</string>`),
        '</array>',
        '</plist>'
      ].join('\n');
      clipboard.writeBuffer('NSFilenamesPboardType', Buffer.from(plist, 'utf8'));
      try {
        clipboard.writeBookmark(path.basename(normalizedPaths[0]), fileUrls[0]);
      } catch (bookmarkError) {
        // ignore bookmark write errors
      }
      setMacOSClipboardFiles(normalizedPaths);
    }
    clipboard.writeBuffer('text/uri-list', uriListBuffer);
    if (process.platform === 'linux') {
      const gnomePayload = `copy\n${fileUrls.join('\n')}\n`;
      clipboard.writeBuffer('x-special/gnome-copied-files', Buffer.from(gnomePayload, 'utf8'));
    }
  } catch (error) {
    writeError = error;
  }
  clipboard.writeText(fallbackText);
  if (writeError) {
    throw writeError;
  }
}

function fileUrlToAbsolutePath(urlValue) {
  if (!urlValue) {
    return null;
  }
  try {
    const parsed = new URL(String(urlValue).trim());
    if (parsed.protocol !== 'file:') {
      return null;
    }
    let pathname = decodeURIComponent(parsed.pathname || '');
    if (process.platform === 'win32') {
      pathname = pathname.replace(/^\/+/, '');
    }
    const resolved = path.resolve(pathname);
    return resolved;
  } catch (error) {
    return null;
  }
}

function parseCFHDrop(buffer) {
  if (!buffer || buffer.length < 20) {
    return [];
  }
  const offset = buffer.readUInt32LE(0);
  const isUnicode = buffer.readUInt32LE(16) !== 0;
  const listBuffer = buffer.slice(offset);
  const encoding = isUnicode ? 'utf16le' : 'utf8';
  const raw = listBuffer.toString(encoding);
  return raw.split('\0').map((value) => value.trim()).filter(Boolean);
}

function parseUriListBuffer(buffer) {
  if (!buffer || buffer.length === 0) {
    return [];
  }
  const text = buffer.toString('utf8');
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && line.startsWith('file:'))
    .map(fileUrlToAbsolutePath)
    .filter(Boolean);
}

function parsePlistBuffer(buffer) {
  if (!buffer || buffer.length === 0) {
    return [];
  }
  const text = buffer.toString('utf8');
  const matches = Array.from(text.matchAll(/<string>([^<]+)<\/string>/gi));
  if (!matches.length) {
    return [];
  }
  return matches
    .map((match) => match[1])
    .map((value) => {
      try {
        return path.resolve(value);
      } catch (error) {
        return null;
      }
    })
    .filter((value) => value && fs.existsSync(value));
}

function parsePotentialPathsFromText(text) {
  if (!text) {
    return [];
  }
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const results = [];
  lines.forEach((line, index) => {
    if (index === 0 && (line === 'copy' || line === 'cut')) {
      return;
    }
    if (line.startsWith('file:')) {
      const urlPath = fileUrlToAbsolutePath(line);
      if (urlPath) {
        results.push(urlPath);
      }
      return;
    }
    if (fs.existsSync(line)) {
      results.push(path.resolve(line));
    }
  });
  return results;
}

function generateUniquePath(targetPath, isDirectory) {
  const resolved = path.resolve(targetPath);
  if (!fs.existsSync(resolved)) {
    return resolved;
  }
  const parentDir = path.dirname(resolved);
  const ext = isDirectory ? '' : path.extname(resolved);
  const baseName = isDirectory ? path.basename(resolved) : path.basename(resolved, ext);
  let counter = 1;
  while (true) {
    const candidateName = isDirectory ? `${baseName}(${counter})` : `${baseName}(${counter})${ext}`;
    const candidatePath = path.join(parentDir, candidateName);
    if (!fs.existsSync(candidatePath)) {
      return candidatePath;
    }
    counter += 1;
  }
}

function copyRecursiveSync(source, destination) {
  const stats = fs.statSync(source);
  if (stats.isDirectory()) {
    if (!fs.existsSync(destination)) {
      fs.mkdirSync(destination, { recursive: true });
    }
    const entries = fs.readdirSync(source);
    const normalizedDestination = path.resolve(destination);
    entries.forEach((entry) => {
      const srcEntry = path.join(source, entry);
      if (path.resolve(srcEntry) === normalizedDestination) {
        return;
      }
      const destEntry = path.join(destination, entry);
      copyRecursiveSync(srcEntry, destEntry);
    });
  } else {
    const destDir = path.dirname(destination);
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }
    fs.copyFileSync(source, destination);
  }
}

function moveEntry(source, destination) {
  const destDir = path.dirname(destination);
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }
  try {
    fs.renameSync(source, destination);
  } catch (error) {
    if (error.code === 'EXDEV') {
      copyRecursiveSync(source, destination);
      fs.rmSync(source, { recursive: true, force: true });
    } else {
      throw error;
    }
  }
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(command, args, options, (error, stdout, stderr) => {
      if (error) {
        const output = (stderr || stdout || '').toString().trim();
        const wrapped = new Error(output || error.message || `Failed to execute ${command}`);
        wrapped.code = error.code || error.errno;
        return reject(wrapped);
      }
      resolve({
        stdout: stdout ? stdout.toString() : '',
        stderr: stderr ? stderr.toString() : ''
      });
    });
  });
}

function escapePowerShellPath(value) {
  if (!value) {
    return "''";
  }
  return `'${String(value).replace(/'/g, "''")}'`;
}

class FileTreeModule {
  constructor(dataRoot) {
    this.dataRoot = dataRoot;
    this.lastClipboardPaths = [];
    this.initializeIpcHandlers();
  }

  // 获取相对 data 目录的路径（统一为 data/... 格式）
  getRelativePath(targetPath) {
    const relative = path.relative(this.dataRoot, targetPath);
    if (!relative) {
      return 'data';
    }
    const normalized = relative.split(path.sep).join('/');
    return `data/${normalized}`;
  }

  // 将绝对路径转换为数据库使用的 data/... 相对路径
  getDatabaseRelativePath(targetPath) {
    const relative = path.relative(this.dataRoot, targetPath);
    if (!relative) {
      return 'data';
    }

    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      return null;
    }

    const normalized = relative.split(path.sep).join('/');
    return normalized ? `data/${normalized}` : 'data';
  }

  // 获取文件类型的排序优先级
  getFileTypePriority(fileName) {
    const ext = path.extname(fileName).toLowerCase();
    const priorityMap = {
      '.pdf': 1,
      '.pptx': 2,
      '.ppt': 2,
      '.html': 3,
      '.htm': 3,
      '.docx': 4,
      '.doc': 4,
      '.txt': 5,
      '.md': 6,
      '.markdown': 6,
      '.json': 7
    };
    return priorityMap[ext] || 999; // 其他文件类型排在最后
  }

  // 递归获取文件树
  getFileTree(dir) {
    const stats = fs.statSync(dir);
    const relativePath = this.getRelativePath(dir);
    if (stats.isFile()) {
      return { name: path.basename(dir), path: dir, relativePath };
    }
    const children = fs.readdirSync(dir)
      .filter(f => !f.startsWith('.')) // 过滤隐藏文件
      .map(f => this.getFileTree(path.join(dir, f)))
      .sort((a, b) => {
        // 文件夹排在前面
        if (a.children && !b.children) return -1;
        if (!a.children && b.children) return 1;
        
        // 如果都是文件，按文件类型优先级排序
        if (!a.children && !b.children) {
          const aPriority = this.getFileTypePriority(a.name);
          const bPriority = this.getFileTypePriority(b.name);
          
          // 如果优先级不同，按优先级排序
          if (aPriority !== bPriority) {
            return aPriority - bPriority;
          }
          
          // 如果优先级相同，按文件名排序
          return a.name.localeCompare(b.name);
        }
        
        // 如果都是文件夹，按名称排序
        return a.name.localeCompare(b.name);
      });
    return { name: path.basename(dir), path: dir, relativePath, children };
  }

  ensureInsideDataRoot(targetPath) {
    if (!targetPath) {
      throw new Error('未提供有效的路径');
    }
    const resolvedTarget = path.resolve(targetPath);
    const resolvedRoot = path.resolve(this.dataRoot);
    if (resolvedTarget === resolvedRoot) {
      return resolvedTarget;
    }
    if (!resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`)) {
      throw new Error('操作被拒绝：目标不在数据目录内');
    }
    return resolvedTarget;
  }

  generateAvailableZipPath(sourcePath, isDirectory) {
    const parentDir = path.dirname(sourcePath);
    const baseName = path.basename(sourcePath);
    const ext = isDirectory ? '' : path.extname(baseName);
    const stem = ext ? baseName.slice(0, -ext.length) : baseName;
    let candidateName = `${stem || baseName}.zip`;
    let candidatePath = path.join(parentDir, candidateName);
    let counter = 1;
    while (fs.existsSync(candidatePath)) {
      candidateName = `${stem || baseName}(${counter}).zip`;
      candidatePath = path.join(parentDir, candidateName);
      counter += 1;
    }
    return candidatePath;
  }

  async compressItem(sourcePath) {
    const resolvedSource = this.ensureInsideDataRoot(sourcePath);
    if (!fs.existsSync(resolvedSource)) {
      throw new Error('目标不存在');
    }
    const stats = fs.statSync(resolvedSource);
    const targetZip = this.generateAvailableZipPath(resolvedSource, stats.isDirectory());
    const parentDir = path.dirname(resolvedSource);
    const sourceBasename = path.basename(resolvedSource);

    try {
      if (process.platform === 'win32') {
        const script = `Compress-Archive -LiteralPath ${escapePowerShellPath(resolvedSource)} -DestinationPath ${escapePowerShellPath(targetZip)} -Force`;
        await runCommand('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true });
      } else {
        const zipArgs = ['-r', path.basename(targetZip), sourceBasename];
        await runCommand('zip', zipArgs, { cwd: parentDir });
      }
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw new Error(process.platform === 'win32'
          ? '未找到 PowerShell，请确认系统已安装 PowerShell'
          : '未找到 zip 命令，请确认系统已安装 zip 工具');
      }
      throw error;
    }

    if (!fs.existsSync(targetZip)) {
      throw new Error('压缩失败：未生成压缩文件');
    }

    return targetZip;
  }

  async extractZipArchive(zipPath) {
    const resolvedZip = this.ensureInsideDataRoot(zipPath);
    if (!fs.existsSync(resolvedZip)) {
      throw new Error('压缩文件不存在');
    }
    const stats = fs.statSync(resolvedZip);
    if (!stats.isFile()) {
      throw new Error('仅支持对zip文件进行解压');
    }
    if (path.extname(resolvedZip).toLowerCase() !== '.zip') {
      throw new Error('文件类型不受支持');
    }
    const parentDir = path.dirname(resolvedZip);
    let tempDir = null;
    try {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-extract-'));
      try {
        if (process.platform === 'win32') {
          const script = `Expand-Archive -LiteralPath ${escapePowerShellPath(resolvedZip)} -DestinationPath ${escapePowerShellPath(tempDir)} -Force`;
          await runCommand('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true });
        } else {
          await runCommand('unzip', ['-q', resolvedZip, '-d', tempDir]);
        }
      } catch (error) {
        if (error.code === 'ENOENT') {
          throw new Error(process.platform === 'win32'
            ? '未找到 PowerShell，请确认系统已安装 PowerShell'
            : '未找到 unzip 命令，请确认系统已安装 unzip 工具');
        }
        throw error;
      }

      const rawEntries = fs.readdirSync(tempDir);
      const filteredEntries = rawEntries.filter((name) => name !== '__MACOSX');
      const entries = filteredEntries.length > 0 ? filteredEntries : rawEntries;
      if (!entries.length) {
        throw new Error('压缩文件为空');
      }

      let extractedTarget = null;
      if (entries.length === 1) {
        const entryName = entries[0];
        const entrySourcePath = path.join(tempDir, entryName);
        if (!fs.existsSync(entrySourcePath)) {
          throw new Error('解压失败：目标条目不存在');
        }
        const entryStats = fs.statSync(entrySourcePath);
        const isDir = entryStats.isDirectory();
        const finalPath = generateUniquePath(path.join(parentDir, entryName), isDir);
        moveEntry(entrySourcePath, finalPath);
        extractedTarget = finalPath;
      } else {
        const baseName = path.basename(resolvedZip, path.extname(resolvedZip)) || 'extracted';
        const targetDir = generateUniquePath(path.join(parentDir, baseName), true);
        fs.mkdirSync(targetDir, { recursive: true });
        entries.forEach((entryName) => {
          const entrySourcePath = path.join(tempDir, entryName);
          if (!fs.existsSync(entrySourcePath)) {
            return;
          }
          const entryDestination = path.join(targetDir, entryName);
          moveEntry(entrySourcePath, entryDestination);
        });
        extractedTarget = targetDir;
      }
      return extractedTarget;
    } finally {
      if (tempDir && fs.existsSync(tempDir)) {
        try {
          fs.rmSync(tempDir, { recursive: true, force: true });
        } catch (cleanupError) {
          console.warn('清理临时解压目录失败:', cleanupError);
        }
      }
    }
  }

  readClipboardFilePaths() {
    const collected = new Set();
    const addPaths = (candidates) => {
      if (!Array.isArray(candidates)) {
        return;
      }
      candidates.forEach((candidate) => {
        if (!candidate) {
          return;
        }
        const resolved = path.resolve(candidate);
        if (fs.existsSync(resolved)) {
          collected.add(resolved);
        }
      });
    };

    try {
      const buffer = clipboard.readBuffer('CF_HDROP');
      addPaths(parseCFHDrop(buffer));
    } catch (error) {
      if (error && error.message && !error.message.includes('Requested clipboard format is not available')) {
        console.warn('读取CF_HDROP剪贴板失败:', error);
      }
    }

    try {
      const fileUrlBuffer = clipboard.readBuffer('public.file-url');
      addPaths(parseUriListBuffer(fileUrlBuffer));
    } catch (error) {
      if (error && error.message && !error.message.includes('Requested clipboard format is not available')) {
        console.warn('读取public.file-url剪贴板失败:', error);
      }
    }

    try {
      const macNamesBuffer = clipboard.readBuffer('NSFilenamesPboardType');
      addPaths(parsePlistBuffer(macNamesBuffer));
    } catch (error) {
      if (error && error.message && !error.message.includes('Requested clipboard format is not available')) {
        console.warn('读取NSFilenames剪贴板失败:', error);
      }
    }

    try {
      const uriBuffer = clipboard.readBuffer('text/uri-list');
      addPaths(parseUriListBuffer(uriBuffer));
    } catch (error) {
      if (error && error.message && !error.message.includes('Requested clipboard format is not available')) {
        console.warn('读取text/uri-list剪贴板失败:', error);
      }
    }

    try {
      const gnomeBuffer = clipboard.readBuffer('x-special/gnome-copied-files');
      const text = gnomeBuffer.toString('utf8');
      addPaths(parsePotentialPathsFromText(text));
    } catch (error) {
      if (error && error.message && !error.message.includes('Requested clipboard format is not available')) {
        console.warn('读取x-special剪贴板失败:', error);
      }
    }

    try {
      const text = clipboard.readText();
      addPaths(parsePotentialPathsFromText(text));
    } catch (error) {
      console.warn('读取文本剪贴板失败:', error);
    }

    return Array.from(collected);
  }

  // 初始化IPC处理器
  initializeIpcHandlers() {
    // 获取文件树
    ipcMain.handle('get-file-tree', () => {
      if (!fs.existsSync(this.dataRoot)) fs.mkdirSync(this.dataRoot);
      const tree = this.getFileTree(this.dataRoot);
      // 直接返回data目录的子文件，不显示根目录
      return {
        name: 'root',
        path: this.dataRoot,
        children: tree.children || []
      };
    });

    // 创建文件夹
    ipcMain.handle('create-folder', (event, parentPath, folderName) => {
      try {
        const newFolderPath = path.join(parentPath, folderName);
        if (!fs.existsSync(newFolderPath)) {
          fs.mkdirSync(newFolderPath);
          return { success: true, path: newFolderPath };
        } else {
          return { success: false, error: '文件夹已存在' };
        }
      } catch (error) {
        console.error('创建文件夹失败:', error);
        return { success: false, error: error.message };
      }
    });

    // 创建文件
    ipcMain.handle('create-file', async (event, parentPath, fileName) => {
      try {
        // 检查父路径是否存在且是目录
        if (!fs.existsSync(parentPath)) {
          return { success: false, error: '父目录不存在' };
        }
        
        const stats = fs.statSync(parentPath);
        if (!stats.isDirectory()) {
          return { success: false, error: '父路径不是目录，无法在文件内创建文件' };
        }
        
        const newFilePath = path.join(parentPath, fileName);
        
        // 智能重名检查：检查是否存在完全相同的文件名和扩展名
        let finalFileName = fileName;
        let counter = 1;
        let finalFilePath = newFilePath;
        
        while (fs.existsSync(finalFilePath)) {
          const fileExt = path.extname(fileName);
          const baseName = path.basename(fileName, fileExt);
          finalFileName = `${baseName}(${counter})${fileExt}`;
          finalFilePath = path.join(parentPath, finalFileName);
          counter++;
        }
        
        // 创建空文件
        fs.writeFileSync(finalFilePath, '');
         
        return { success: true, path: finalFilePath, actualName: finalFileName };
      } catch (error) {
        console.error('创建文件失败:', error);
        return { success: false, error: error.message };
      }
    });

    // 删除文件或文件夹
    ipcMain.handle('delete-item', async (event, itemPath) => {
      try {
        // 获取项目根目录路径
        const cleanRelativePath = this.getDatabaseRelativePath(itemPath);
        
        // 检查是否为文件夹
        const stats = fs.statSync(itemPath);
        const isFolder = stats.isDirectory();
        
        // 1. 首先调用后端API删除数据库中的数据
        if (cleanRelativePath) {
          try {
            const response = await axios.delete('http://127.0.0.1:8000/api/document/delete', {
              data: {
                file_path: cleanRelativePath,
                is_folder: isFolder
              },
              timeout: 5000, // 5秒超时
              headers: {
                'Content-Type': 'application/json'
              }
            });
            
            if (response.data.status === 'success') {
              console.log('数据库删除成功:', response.data);
            } else {
              console.warn('数据库删除警告:', response.data.message);
            }
          } catch (dbError) {
            console.error('数据库删除失败:', dbError.message);
            // 数据库删除失败，可以选择是否继续文件删除操作
            // 这里选择继续文件删除，但记录错误日志
          }
        } else {
          console.warn('删除操作未同步数据库：目标路径不在数据目录内', itemPath);
        }
        
        // 2. 删除文件系统上的文件或文件夹
        if (isFolder) {
          // 递归删除文件夹及其内容
          fs.rmSync(itemPath, { recursive: true, force: true });
        } else {
          // 删除文件
          fs.unlinkSync(itemPath);
        }
        
        return { success: true };
      } catch (error) {
        console.error('删除失败:', error);
        return { success: false, error: error.message };
      }
    });

    // 重命名文件或文件夹
    ipcMain.handle('rename-item', async (event, itemPath, newName) => {
      try {
        // 获取父目录路径
        const parentDir = path.dirname(itemPath);
        // 构建新的完整路径
        const newPath = path.join(parentDir, newName);
        
        // 如果新路径与原路径相同，直接返回成功（名称未改变）
        if (newPath === itemPath) {
          return { success: true, newPath: newPath };
        }
        
        // 检查新名称是否已存在
        if (fs.existsSync(newPath)) {
          return { success: false, error: '该名称已存在' };
        }
        
        // 重命名文件或文件夹
        fs.renameSync(itemPath, newPath);
        
        // 获取项目根目录路径
        const cleanRelativeOldPath = this.getDatabaseRelativePath(itemPath);
        const cleanRelativeNewPath = this.getDatabaseRelativePath(newPath);
        
        // 检查是否为文件夹
        const isFolder = fs.statSync(newPath).isDirectory();
        
        // 更新数据库中的文件路径
        let dbUpdateSuccess = true;
        let dbUpdateMessage = '';
        
        if (cleanRelativeOldPath && cleanRelativeNewPath) {
          try {
            const response = await axios.post('http://127.0.0.1:8000/api/document/update-path', {
              old_path: cleanRelativeOldPath,
              new_path: cleanRelativeNewPath,
              is_folder: isFolder
            }, {
              timeout: 5000, // 5秒超时
              headers: {
                'Content-Type': 'application/json'
              }
            });
            
            console.log('数据库路径更新成功:', response.data);
            
            // 检查后端响应状态
            if (response.data && response.data.status === 'error') {
              dbUpdateSuccess = false;
              dbUpdateMessage = response.data.message || '数据库路径更新失败';
            }
            
          } catch (dbError) {
            console.error('更新数据库路径失败:', dbError.message);
            dbUpdateSuccess = false;
            dbUpdateMessage = dbError.message;
          }
        } else {
          dbUpdateSuccess = false;
          dbUpdateMessage = '无法计算数据库相对路径';
        }
        
        return { 
          success: true, 
          newPath: newPath,
          dbUpdateSuccess: dbUpdateSuccess,
          dbUpdateMessage: dbUpdateMessage
        };
      } catch (error) {
        console.error('重命名失败:', error);
        return { success: false, error: error.message };
      }
    });

    // 移动文件或文件夹
    ipcMain.handle('move-item', async (event, sourcePath, targetPath) => {
      try {
        // 检查源文件是否存在
        if (!fs.existsSync(sourcePath)) {
          return { success: false, error: '源文件不存在' };
        }
        
        // 检查目标路径是否存在
        if (!fs.existsSync(targetPath)) {
          return { success: false, error: '目标路径不存在' };
        }
        
        // 确保目标路径是目录
        const targetStats = fs.statSync(targetPath);
        if (!targetStats.isDirectory()) {
          return { success: false, error: '目标路径必须是文件夹' };
        }
        
        // 获取源文件名
        const fileName = path.basename(sourcePath);
        const newPath = path.join(targetPath, fileName);
        
        // 检查目标位置是否已存在同名文件
        if (fs.existsSync(newPath)) {
          return { success: false, error: '目标位置已存在同名文件' };
        }
        
        // 检查是否试图将文件夹移动到自己的子目录中
        const sourceStats = fs.statSync(sourcePath);
        if (sourceStats.isDirectory()) {
          const relativePath = path.relative(sourcePath, targetPath);
          if (!relativePath || !relativePath.startsWith('..')) {
            return { success: false, error: '不能将文件夹移动到自己的子目录中' };
          }
        }
        
        // 执行移动操作
        fs.renameSync(sourcePath, newPath);
        
        // 获取项目根目录路径
        const cleanRelativeOldPath = this.getDatabaseRelativePath(sourcePath);
        const cleanRelativeNewPath = this.getDatabaseRelativePath(newPath);
        
        // 检查是否为文件夹
        const isFolder = fs.statSync(newPath).isDirectory();
        
        // 更新数据库中的文件路径
        let dbUpdateSuccess = true;
        let dbUpdateMessage = '';
        
        if (cleanRelativeOldPath && cleanRelativeNewPath) {
          try {
            const response = await axios.post('http://127.0.0.1:8000/api/document/update-path', {
              old_path: cleanRelativeOldPath,
              new_path: cleanRelativeNewPath,
              is_folder: isFolder
            }, {
              timeout: 5000, // 5秒超时
              headers: {
                'Content-Type': 'application/json'
              }
            });
            
            console.log('数据库路径更新成功:', response.data);
            
            // 检查后端响应状态
            if (response.data && response.data.status === 'error') {
              dbUpdateSuccess = false;
              dbUpdateMessage = response.data.message || '数据库路径更新失败';
            }
            
          } catch (dbError) {
            console.error('更新数据库路径失败:', dbError.message);
            dbUpdateSuccess = false;
            dbUpdateMessage = dbError.message;
          }
        } else {
          dbUpdateSuccess = false;
          dbUpdateMessage = '无法计算数据库相对路径';
        }
        
        return { 
          success: true, 
          newPath: newPath,
          dbUpdateSuccess: dbUpdateSuccess,
          dbUpdateMessage: dbUpdateMessage
        };
      } catch (error) {
        console.error('移动文件失败:', error);
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle('copy-item-to-clipboard', (event, itemPath) => {
      try {
        const resolvedPath = this.ensureInsideDataRoot(itemPath);
        writePathsToClipboard([resolvedPath]);
        this.lastClipboardPaths = [resolvedPath];
        return { success: true, path: resolvedPath };
      } catch (error) {
        console.error('复制文件到剪贴板失败:', error);
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle('compress-item', async (event, itemPath) => {
      try {
        const zipPath = await this.compressItem(itemPath);
        return { success: true, zipPath };
      } catch (error) {
        console.error('压缩失败:', error);
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle('extract-zip', async (event, zipPath) => {
      try {
        const extractedPath = await this.extractZipArchive(zipPath);
        return { success: true, extractedPath };
      } catch (error) {
        console.error('解压失败:', error);
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle('paste-from-clipboard', async (event, targetPath) => {
      try {
        const defaultTarget = this.dataRoot;
        const initialTarget = targetPath ? this.ensureInsideDataRoot(targetPath) : defaultTarget;
        if (!initialTarget) {
          throw new Error('无法确定粘贴目标路径');
        }

        let targetFolder = initialTarget;
        if (!fs.existsSync(targetFolder)) {
          throw new Error('目标路径不存在');
        }
        const targetStats = fs.statSync(targetFolder);
        if (!targetStats.isDirectory()) {
          const parentDir = path.dirname(targetFolder);
          targetFolder = this.ensureInsideDataRoot(parentDir);
        }

        if (!fs.existsSync(targetFolder)) {
          fs.mkdirSync(targetFolder, { recursive: true });
        }

        const clipboardPaths = this.readClipboardFilePaths();
        const effectiveSources = clipboardPaths.length ? clipboardPaths : this.lastClipboardPaths;
        if (!effectiveSources || effectiveSources.length === 0) {
          throw new Error('剪贴板中未找到文件或文件夹');
        }

        const uniqueSources = Array.from(new Set(effectiveSources.map((item) => path.resolve(item))))
          .filter((candidate) => fs.existsSync(candidate));

        if (!uniqueSources.length) {
          throw new Error('剪贴板中文件已不存在');
        }

        const createdPaths = [];
        uniqueSources.forEach((sourcePath) => {
          const stats = fs.statSync(sourcePath);
          const baseName = path.basename(sourcePath);
          const candidateDestination = path.join(targetFolder, baseName);
          const destinationPath = generateUniquePath(candidateDestination, stats.isDirectory());
          copyRecursiveSync(sourcePath, destinationPath);
          createdPaths.push(destinationPath);
        });

        this.lastClipboardPaths = uniqueSources;

        return { success: true, items: createdPaths };
      } catch (error) {
        console.error('粘贴失败:', error);
        return { success: false, error: error.message };
      }
    });
  }

  // 获取数据根目录
  getDataRoot() {
    return this.dataRoot;
  }
}

module.exports = FileTreeModule;
