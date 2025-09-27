// 文件树模块 - 主进程逻辑
const { ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const axios = require('axios');


class FileTreeModule {
  constructor(dataRoot) {
    this.dataRoot = dataRoot;
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
        const projectRoot = path.join(__dirname, '../..');
        const relativePath = path.relative(projectRoot, itemPath).replace(/\\/g, '/');
        
        // 确保路径格式正确（移除开头的../）
        const cleanRelativePath = relativePath.startsWith('../') ? relativePath.substring(3) : relativePath;
        
        // 检查是否为文件夹
        const stats = fs.statSync(itemPath);
        const isFolder = stats.isDirectory();
        
        // 1. 首先调用后端API删除数据库中的数据
        try {
          const axios = require('axios');
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
        const projectRoot = path.join(__dirname, '../..');
        const relativeOldPath = path.relative(projectRoot, itemPath).replace(/\\/g, '/');
        const relativeNewPath = path.relative(projectRoot, newPath).replace(/\\/g, '/');
        
        // 确保路径格式正确（移除开头的../）
        const cleanRelativeOldPath = relativeOldPath.startsWith('../') ? relativeOldPath.substring(3) : relativeOldPath;
        const cleanRelativeNewPath = relativeNewPath.startsWith('../') ? relativeNewPath.substring(3) : relativeNewPath;
        
        // 检查是否为文件夹
        const isFolder = fs.statSync(newPath).isDirectory();
        
        // 更新数据库中的文件路径
        let dbUpdateSuccess = true;
        let dbUpdateMessage = '';
        
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
        const projectRoot = path.join(__dirname, '../..');
        const relativeOldPath = path.relative(projectRoot, sourcePath).replace(/\\/g, '/');
        const relativeNewPath = path.relative(projectRoot, newPath).replace(/\\/g, '/');
        
        // 确保路径格式正确（移除开头的../）
        const cleanRelativeOldPath = relativeOldPath.startsWith('../') ? relativeOldPath.substring(3) : relativeOldPath;
        const cleanRelativeNewPath = relativeNewPath.startsWith('../') ? relativeNewPath.substring(3) : relativeNewPath;
        
        // 检查是否为文件夹
        const isFolder = fs.statSync(newPath).isDirectory();
        
        // 更新数据库中的文件路径
        let dbUpdateSuccess = true;
        let dbUpdateMessage = '';
        
        try {
          const axios = require('axios');
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
  }

  // 获取数据根目录
  getDataRoot() {
    return this.dataRoot;
  }
}

module.exports = FileTreeModule;
