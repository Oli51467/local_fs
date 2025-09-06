const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

// 设置文件路径
const settingsPath = path.join(__dirname, 'settings.json');

// 默认设置
const defaultSettings = {
  darkMode: false
};

function createWindow() {
  const win = new BrowserWindow({
    width: 1300,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.loadFile(path.join(__dirname, 'index.html'));
}

// 根目录为项目根 data 文件夹
const dataRoot = path.join(__dirname, '..', 'data');

// 递归获取文件树
function getFileTree(dir) {
  const stats = fs.statSync(dir);
  if (stats.isFile()) {
    return { name: path.basename(dir), path: dir };
  }
  const children = fs.readdirSync(dir)
    .filter(f => !f.startsWith('.')) // 过滤隐藏文件
    .map(f => getFileTree(path.join(dir, f)))
    .sort((a, b) => {
      // 文件夹排在前面
      if (a.children && !b.children) return -1;
      if (!a.children && b.children) return 1;
      return a.name.localeCompare(b.name);
    });
  return { name: path.basename(dir), path: dir, children };
}

// IPC
ipcMain.handle('get-file-tree', () => {
  if (!fs.existsSync(dataRoot)) fs.mkdirSync(dataRoot);
  const tree = getFileTree(dataRoot);
  // 直接返回data目录的子文件，不显示根目录
  return {
    name: 'root',
    path: dataRoot,
    children: tree.children || []
  };
});

ipcMain.handle('read-file', (event, filePath) => {
  return fs.readFileSync(filePath, 'utf-8');
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

// 保存设置
ipcMain.handle('save-settings', (event, settings) => {
  try {
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
    return { success: true };
  } catch (error) {
    console.error('保存设置失败:', error);
    return { success: false, error: error.message };
  }
});

// 获取设置
ipcMain.handle('get-settings', () => {
  try {
    if (fs.existsSync(settingsPath)) {
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      return settings;
    }
    return defaultSettings;
  } catch (error) {
    console.error('获取设置失败:', error);
    return defaultSettings;
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


// 启动Python后端
let pythonProcess = null;

function startPythonBackend() {
  const isProduction = process.env.NODE_ENV === 'production';
  let pythonExecutablePath;
  
  if (isProduction) {
    // 在打包后的应用中，Python后端已经被打包
    if (process.platform === 'win32') {
      pythonExecutablePath = path.join(process.resourcesPath, 'python_backend', 'python_backend.exe');
    } else if (process.platform === 'darwin') {
      pythonExecutablePath = path.join(process.resourcesPath, 'python_backend', 'python_backend');
    } else {
      pythonExecutablePath = path.join(process.resourcesPath, 'python_backend', 'python_backend');
    }
  } else {
    // 在开发环境中，直接运行Python脚本
    const pythonPath = process.platform === 'win32' ? 'python' : 'python3';
    pythonExecutablePath = pythonPath;
    
    // 使用子进程运行Python脚本
    pythonProcess = require('child_process').spawn(pythonExecutablePath, [path.join(__dirname, '..', 'server', 'main.py')]);
    
    pythonProcess.stdout.on('data', (data) => {
      console.log(`Python stdout: ${data}`);
    });
    
    pythonProcess.stderr.on('data', (data) => {
      console.error(`Python stderr: ${data}`);
    });
    
    pythonProcess.on('close', (code) => {
      console.log(`Python process exited with code ${code}`);
    });
    
    return;
  }
  
  // 在生产环境中运行打包后的Python可执行文件
  pythonProcess = require('child_process').execFile(pythonExecutablePath);
  
  pythonProcess.stdout.on('data', (data) => {
    console.log(`Python stdout: ${data}`);
  });
  
  pythonProcess.stderr.on('data', (data) => {
    console.error(`Python stderr: ${data}`);
  });
  
  pythonProcess.on('close', (code) => {
    console.log(`Python process exited with code ${code}`);
  });
}

// 在应用启动时启动Python后端
app.whenReady().then(() => {
  createWindow();
  startPythonBackend();
});

// 在应用退出时关闭Python后端
app.on('will-quit', () => {
  if (pythonProcess) {
    process.platform === 'win32' ? require('child_process').exec(`taskkill /pid ${pythonProcess.pid} /f /t`) : pythonProcess.kill();
  }
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
