const { app, BrowserWindow } = require('electron');
const path = require('path');

// 禁用硬件加速以避免GPU相关的Mach端口问题
app.disableHardwareAcceleration();

// 修复 macOS 上的 Mach 端口权限错误
if (process.platform === 'darwin') {
  app.commandLine.appendSwitch('--no-sandbox');
  app.commandLine.appendSwitch('--disable-dev-shm-usage');
  app.commandLine.appendSwitch('--disable-web-security');
  app.commandLine.appendSwitch('--disable-gpu');
  app.commandLine.appendSwitch('--disable-gpu-sandbox');
  app.commandLine.appendSwitch('--disable-software-rasterizer');
  app.commandLine.appendSwitch('--disable-background-timer-throttling');
  app.commandLine.appendSwitch('--disable-renderer-backgrounding');
  app.commandLine.appendSwitch('--disable-backgrounding-occluded-windows');
  app.commandLine.appendSwitch('--disable-ipc-flooding-protection');
}

// 引入各个功能模块
const FileTreeModule = require('./src/modules/file-tree');
const FileViewerModule = require('./src/modules/file-viewer');
const SettingsBackendModule = require('./src/modules/settings-backend');
const FileImportModule = require('./src/modules/file-import');
const PythonBackendModule = require('./src/modules/python-backend');

// 根目录为项目根 data 文件夹
const dataRoot = path.join(__dirname, '..', 'data');

function createWindow() {
  const win = new BrowserWindow({
    width: 1300,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
      allowRunningInsecureContent: true,
      experimentalFeatures: false,
      enableBlinkFeatures: '',
      disableBlinkFeatures: 'Auxclick'
    }
  });

  win.loadFile(path.join(__dirname, 'index.html'));
}

// 初始化各个功能模块
function initializeModules() {
  const fileTreeModule = new FileTreeModule(dataRoot);
  const fileViewerModule = new FileViewerModule();
  const settingsBackendModule = new SettingsBackendModule();
  const fileImportModule = new FileImportModule(dataRoot);
  const pythonBackendModule = new PythonBackendModule();
  
  return {
    fileTreeModule,
    fileViewerModule,
    settingsBackendModule,
    fileImportModule,
    pythonBackendModule
  };
}

// 所有IPC处理器已迁移到对应的功能模块中

// 应用启动和模块初始化
let modules = null;

app.whenReady().then(() => {
  // 创建主窗口
  createWindow();
  
  // 初始化所有功能模块
  modules = initializeModules();
  
  // 启动Python后端
  modules.pythonBackendModule.startPythonBackend();
});

// 应用退出时的清理工作 
app.on('will-quit', () => {
  if (modules) {
    if (modules.pythonBackendModule) {
      modules.pythonBackendModule.stopPythonBackend();
    }
    if (modules.settingsBackendModule) {
      modules.settingsBackendModule.destroy();
    }
  }
});

// 所有窗口关闭时的处理
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
