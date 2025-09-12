// 文件树模块 - 主进程逻辑
const { ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');

// 尝试加载docx库
let docxLib = null;
try {
  docxLib = require('docx');
  console.log('docx库加载成功');
} catch (error) {
  console.warn('docx库加载失败:', error.message);
}

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
        
        // 根据文件扩展名提供初始内容
         const fileExt = path.extname(finalFileName).toLowerCase();
         
         if (fileExt === '.docx') {
            // 使用docx库创建Word文档
            if (docxLib) {
              try {
                const { Document, Packer, Paragraph, TextRun } = docxLib;
                
                const doc = new Document({
                  sections: [
                    {
                      properties: {},
                      children: [
                        new Paragraph({
                          children: [
                            new TextRun(""),
                          ],
                        }),
                      ],
                    },
                  ],
                });
                
                // 同步创建Word文档，避免重复创建问题
                try {
                  const buffer = await Packer.toBuffer(doc);
                  fs.writeFileSync(finalFilePath, buffer);
                  console.log('Word文档创建成功:', finalFilePath);
                } catch (error) {
                  console.error('创建Word文档失败:', error);
                  // 如果docx库创建失败，回退到文本方式
                  fs.writeFileSync(finalFilePath, '');
                }
                
              } catch (error) {
                console.error('docx库使用失败，使用文本方式:', error);
                // 如果docx库不可用，回退到文本方式
                fs.writeFileSync(finalFilePath, '');
              }
            } else {
              console.warn('docx库未加载，使用文本方式创建.docx文件');
              fs.writeFileSync(finalFilePath, '');
            }
          } else {
            // 其他文件类型创建空文件
            fs.writeFileSync(finalFilePath, '');
          }
         
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
  }

  // 获取数据根目录
  getDataRoot() {
    return this.dataRoot;
  }
}

module.exports = FileTreeModule;