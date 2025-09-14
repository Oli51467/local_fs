// 文件树模块 - 主进程逻辑
const { ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');


class FileTreeModule {
  constructor(dataRoot) {
    this.dataRoot = dataRoot;
    this.initializeIpcHandlers();
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
    if (stats.isFile()) {
      return { name: path.basename(dir), path: dir };
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
    return { name: path.basename(dir), path: dir, children };
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
    ipcMain.handle('delete-item', (event, itemPath) => {
      try {
        const stats = fs.statSync(itemPath);
        if (stats.isDirectory()) {
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
    ipcMain.handle('rename-item', (event, itemPath, newName) => {
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
        return { success: true, newPath: newPath };
      } catch (error) {
        console.error('重命名失败:', error);
        return { success: false, error: error.message };
      }
    });

    // 移动文件或文件夹
    ipcMain.handle('move-item', (event, sourcePath, targetPath) => {
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
        return { success: true, newPath: newPath };
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