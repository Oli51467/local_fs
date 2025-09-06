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
    width: 1200,
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
  const children = fs.readdirSync(dir).map(f => getFileTree(path.join(dir, f)));
  return { name: path.basename(dir), path: dir, children };
}

// IPC
ipcMain.handle('get-file-tree', () => {
  if (!fs.existsSync(dataRoot)) fs.mkdirSync(dataRoot);
  return getFileTree(dataRoot);
});

ipcMain.handle('read-file', (event, filePath) => {
  return fs.readFileSync(filePath, 'utf-8');
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

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
