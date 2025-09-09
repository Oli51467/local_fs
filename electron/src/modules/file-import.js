const fs = require('fs');
const path = require('path');
const { ipcMain, dialog } = require('electron');

class FileImportModule {
  constructor(dataRoot) {
    this.dataRoot = dataRoot;
    this.registerIpcHandlers();
  }

  registerIpcHandlers() {
    // 文件选择器
    ipcMain.handle('select-files', async () => {
      return this.selectFiles();
    });

    // 导入文件/文件夹
    ipcMain.handle('import-files', async (event, targetPath, filePaths) => {
      return this.importFiles(targetPath, filePaths);
    });
  }

  async selectFiles() {
    try {
      const result = await dialog.showOpenDialog({
        title: '选择要导入的文件或文件夹',
        properties: ['openFile', 'openDirectory', 'multiSelections'],
        filters: [
          { name: '所有文件', extensions: ['*'] }
        ]
      });
      
      if (result.canceled) {
        return { success: false, canceled: true };
      }
      
      return { success: true, filePaths: result.filePaths };
    } catch (error) {
      console.error('文件选择失败:', error);
      return { success: false, error: error.message };
    }
  }

  async importFiles(targetPath, filePaths) {
    try {
      const results = [];
      
      for (const sourcePath of filePaths) {
        // 检查源文件是否在data目录下，防止递归导入
        const normalizedSourcePath = path.resolve(sourcePath);
        const normalizedDataRoot = path.resolve(this.dataRoot);
        
        if (normalizedSourcePath.startsWith(normalizedDataRoot)) {
          results.push({ 
            sourcePath, 
            success: false, 
            error: '不能导入系统数据目录下的文件，这会导致递归循环' 
          });
          continue;
        }
        
        const sourceName = path.basename(sourcePath);
        const destPath = path.join(targetPath, sourceName);
        
        // 检查目标路径是否已存在
        if (fs.existsSync(destPath)) {
          results.push({ 
            sourcePath, 
            success: false, 
            error: `${sourceName} 已存在` 
          });
          continue;
        }
        
        try {
          // 复制文件或文件夹
          await this.copyFileOrFolder(sourcePath, destPath);
          results.push({ 
            sourcePath, 
            destPath,
            success: true 
          });
        } catch (copyError) {
          results.push({ 
            sourcePath, 
            success: false, 
            error: copyError.message 
          });
        }
      }
      
      return { success: true, results };
    } catch (error) {
      console.error('导入文件失败:', error);
      return { success: false, error: error.message };
    }
  }

  // 递归复制文件或文件夹的辅助函数
  async copyFileOrFolder(source, dest) {
    const stats = fs.statSync(source);
    
    if (stats.isFile()) {
      // 复制文件
      fs.copyFileSync(source, dest);
    } else if (stats.isDirectory()) {
      // 创建目标文件夹
      fs.mkdirSync(dest, { recursive: true });
      
      // 递归复制文件夹内容
      const items = fs.readdirSync(source);
      for (const item of items) {
        const sourcePath = path.join(source, item);
        const destPath = path.join(dest, item);
        await this.copyFileOrFolder(sourcePath, destPath);
      }
    }
  }
}

module.exports = FileImportModule;