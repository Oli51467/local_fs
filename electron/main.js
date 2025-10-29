const { app, BrowserWindow, ipcMain, nativeTheme, nativeImage, systemPreferences } = require('electron');
const fs = require('fs');
const path = require('path');

// Ensure runtime checks see the correct environment for packaged builds
if (app.isPackaged) {
  process.env.NODE_ENV = 'production';
} else {
  process.env.NODE_ENV = process.env.NODE_ENV || 'development';
}

// 禁用硬件加速以避免GPU相关的Mach端口问题
app.disableHardwareAcceleration();

function normalizeMacTextInputPreferences() {
  if (process.platform !== 'darwin') {
    return;
  }
  try {
    systemPreferences.setUserDefault('ApplePressAndHoldEnabled', 'boolean', false);
  } catch (error) {
    console.warn('Failed to normalize ApplePressAndHoldEnabled preference:', error);
  }
}

normalizeMacTextInputPreferences();

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
const RuntimePathsModule = require('./src/modules/runtime-paths');

function resolveAppPaths() {
  const appRoot = path.join(__dirname, '..');
  const userDataBase = path.join(app.getPath('userData'), 'fs-app');
  const externalRoot = app.isPackaged ? userDataBase : appRoot;
  const dataRoot = path.join(externalRoot, 'data');
  const metaRoot = path.join(externalRoot, 'meta');

  const ensureDir = (target) => {
    try {
      fs.mkdirSync(target, { recursive: true });
    } catch (error) {
      console.error('Failed to ensure directory:', target, error);
    }
  };

  ensureDir(externalRoot);
  ensureDir(dataRoot);
  ensureDir(metaRoot);

  if (app.isPackaged) {
    const seedDirectory = (source, destination) => {
      if (!fs.existsSync(source)) {
        return;
      }
      try {
        const destinationExists = fs.existsSync(destination);
        const destinationEmpty = !destinationExists || fs.readdirSync(destination).length === 0;
        if (destinationEmpty) {
          fs.mkdirSync(destination, { recursive: true });
          fs.cpSync(source, destination, { recursive: true, force: false, errorOnExist: false });
        }
      } catch (error) {
        console.warn('Failed to seed directory from resources:', source, '->', destination, error);
      }
    };

    const resourcesBase = process.resourcesPath;
    seedDirectory(path.join(resourcesBase, 'data'), dataRoot);
    seedDirectory(path.join(resourcesBase, 'meta'), metaRoot);
  }

  return {
    appRoot,
    externalRoot,
    dataRoot,
    metaRoot,
  };
}

function getIconCandidatePaths() {
  const assetNames = [];
  if (process.platform === 'darwin') {
    assetNames.push(path.join('dist', 'assets', 'logo.icns'));
  }
  assetNames.push(path.join('dist', 'assets', 'logo.png'));

  const bases = new Set([
    __dirname,
    path.join(__dirname, '..'),
    process.resourcesPath,
    process.resourcesPath ? path.join(process.resourcesPath, 'app.asar.unpacked') : null
  ].filter(Boolean));

  const candidates = new Set();
  bases.forEach((base) => {
    assetNames.forEach((asset) => {
      candidates.add(path.join(base, asset));
    });
  });
  return Array.from(candidates);
}

function loadAppIcon() {
  const candidates = getIconCandidatePaths();
  for (const candidate of candidates) {
    try {
      if (!candidate || !fs.existsSync(candidate)) {
        continue;
      }
      let image = nativeImage.createFromPath(candidate);
      if (image && !image.isEmpty()) {
        image.setTemplateImage(false);
        return image;
      }
      const buffer = fs.readFileSync(candidate);
      if (buffer && buffer.length) {
        image = nativeImage.createFromBuffer(buffer);
        if (image && !image.isEmpty()) {
          image.setTemplateImage(false);
          return image;
        }
      }
    } catch (error) {
      console.warn('Failed to load icon candidate:', candidate, error);
    }
  }
  return null;
}

function applyAppIcon(image) {
  if (!image || image.isEmpty()) {
    return;
  }
  if (process.platform === 'darwin' && app.dock) {
    try {
      app.dock.setIcon(image);
    } catch (error) {
      console.warn('Failed to apply dock icon:', error);
    }
  }
}

let appIconImage = null;

function createWindow() {
  const win = new BrowserWindow({
    width: 1300,
    height: 800,
    icon: appIconImage && !appIconImage.isEmpty() ? appIconImage : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
      experimentalFeatures: false,
      enableBlinkFeatures: '',
      disableBlinkFeatures: 'Auxclick'
    }
  });

  // 监听主题变化
  ipcMain.handle('set-title-bar-theme', (event, isDarkMode) => {
    if (process.platform === 'darwin') {
      // macOS 使用 nativeTheme 来控制标题栏主题
      nativeTheme.themeSource = isDarkMode ? 'dark' : 'light';
    }
    // Windows 会自动跟随系统主题，这里不需要额外处理
  });

  win.loadFile(path.join(__dirname, 'index.html'));

  if (appIconImage && !appIconImage.isEmpty()) {
    if (process.platform === 'win32' || process.platform === 'linux') {
      try {
        win.setIcon(appIconImage);
      } catch (error) {
        console.warn('Failed to set window icon:', error);
      }
    } else if (process.platform === 'darwin') {
      applyAppIcon(appIconImage);
      win.on('minimize', () => applyAppIcon(appIconImage));
      win.on('restore', () => applyAppIcon(appIconImage));
    }
  }
}

// 初始化各个功能模块
function initializeModules(appPaths) {
  const runtimePathsModule = new RuntimePathsModule(appPaths);
  const fileTreeModule = new FileTreeModule(appPaths.dataRoot);
  const fileViewerModule = new FileViewerModule();
  const settingsBackendModule = new SettingsBackendModule();
  const fileImportModule = new FileImportModule(appPaths.dataRoot);
  const pythonBackendModule = new PythonBackendModule(appPaths);

  return {
    runtimePathsModule,
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
let appPaths = null;

app.whenReady().then(async () => {
  appPaths = resolveAppPaths();
  process.env.FS_APP_EXTERNAL_ROOT = appPaths.externalRoot;
  process.env.FS_APP_DATA_DIR = appPaths.dataRoot;
  process.env.FS_APP_META_DIR = appPaths.metaRoot;
  process.env.FS_APP_API_HOST = process.env.FS_APP_API_HOST || '127.0.0.1';

  if (!appIconImage || appIconImage.isEmpty()) {
    appIconImage = loadAppIcon();
  }
  applyAppIcon(appIconImage);

  // 初始化所有功能模块
  modules = initializeModules(appPaths);

  // 创建主窗口，确保欢迎页尽快显示
  createWindow();
  
  // 启动Python后端
  let backendReady = false;
  try {
    backendReady = await modules.pythonBackendModule.startPythonBackend();
  } catch (error) {
    console.error('Failed to start Python backend:', error);
  }

  if (!backendReady) {
    console.warn('Python backend did not report ready; continuing to launch UI for diagnostics.');
  }
});

app.on('browser-window-created', (_event, window) => {
  if (!appIconImage || appIconImage.isEmpty()) {
    return;
  }
  if (process.platform === 'win32' || process.platform === 'linux') {
    try {
      window.setIcon(appIconImage);
    } catch (error) {
      console.warn('Failed to set icon on new window:', error);
    }
  } else if (process.platform === 'darwin') {
    applyAppIcon(appIconImage);
  }
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
  // 无论平台，一旦所有窗口关闭则退出应用
  app.quit();
});
