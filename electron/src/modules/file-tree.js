// 文件树模块 - 主进程逻辑
const { ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');

class FileTreeModule {
  constructor(dataRoot) {
    this.dataRoot = dataRoot;
    this.initializeIpcHandlers();
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
    ipcMain.handle('create-file', (event, parentPath, fileName) => {
      try {
        const newFilePath = path.join(parentPath, fileName);
        if (!fs.existsSync(newFilePath)) {
          fs.writeFileSync(newFilePath, '');
          return { success: true, path: newFilePath };
        } else {
          return { success: false, error: '文件已存在' };
        }
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
  }

  // 获取数据根目录
  getDataRoot() {
    return this.dataRoot;
  }
}

module.exports = FileTreeModule;