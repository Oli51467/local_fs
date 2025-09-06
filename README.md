# Electron + Python 应用打包指南

本项目是一个结合 Electron 前端和 Python (FastAPI) 后端的桌面应用示例，并提供了完整的打包方案，可以将两者打包为单一可执行文件。

## 项目结构

```
├── electron/         # Electron 前端
│   ├── icons.js
│   ├── index.html
│   ├── main.js
│   ├── package.json
│   ├── preload.js
│   ├── renderer.js
│   └── settings.json
├── server/           # Python 后端
│   ├── main.py       # FastAPI 应用
│   └── requirements.txt
└── package.py        # 打包脚本
```

## 打包前准备

### 安装依赖

1. 确保已安装 Node.js 和 npm
2. 确保已安装 Python 3.x
3. 安装 Python 依赖：

```bash
pip install -r server/requirements.txt
pip install pyinstaller
```

4. 安装 Electron 依赖：

```bash
cd electron
npm install
```

## 打包流程

### 使用打包脚本

我们提供了一个自动化打包脚本 `package.py`，它会完成以下工作：

1. 使用 PyInstaller 打包 Python 后端
2. 更新 Electron 文件以支持启动打包后的 Python 后端
3. 创建 electron-builder 配置
4. 使用 electron-builder 打包整个应用

运行打包脚本：

```bash
python package.py
```

打包完成后，可执行文件将位于 `electron/dist/` 目录下。

### 手动打包步骤

如果您想了解详细的打包过程或需要自定义打包步骤，可以参考以下手动打包流程：

#### 1. 打包 Python 后端

使用 PyInstaller 打包 Python 后端：

```bash
# 创建 spec 文件
pyinstaller --name python_backend --noconfirm --windowed --collect-all uvicorn server/main.py

# 移动打包后的文件到 electron 目录
mv dist/python_backend electron/
```

#### 2. 更新 Electron 配置

修改 `electron/package.json` 文件，添加 electron-builder 配置：

```json
{
  "build": {
    "appId": "com.electron.python.app",
    "productName": "Electron Python App",
    "extraResources": [
      {
        "from": "python_backend",
        "to": "python_backend",
        "filter": ["**/*"]
      }
    ],
    "mac": {
      "category": "public.app-category.utilities",
      "target": ["dmg"]
    },
    "win": {
      "target": ["nsis"]
    },
    "linux": {
      "target": ["AppImage", "deb"],
      "category": "Utility"
    }
  }
}
```

#### 3. 修改 Electron 主进程代码

更新 `electron/main.js` 文件，添加启动 Python 后端的代码：

```javascript
// 启动 Python 后端
let pythonProcess = null;

function startPythonBackend() {
  const isProduction = process.env.NODE_ENV === 'production';
  let pythonExecutablePath;
  
  if (isProduction) {
    // 在打包后的应用中，Python 后端已经被打包
    if (process.platform === 'win32') {
      pythonExecutablePath = path.join(process.resourcesPath, 'python_backend', 'python_backend.exe');
    } else {
      pythonExecutablePath = path.join(process.resourcesPath, 'python_backend', 'python_backend');
    }
    
    // 在生产环境中运行打包后的 Python 可执行文件
    pythonProcess = require('child_process').execFile(pythonExecutablePath);
  } else {
    // 在开发环境中，直接运行 Python 脚本
    const pythonPath = process.platform === 'win32' ? 'python' : 'python3';
    pythonProcess = require('child_process').spawn(pythonPath, [path.join(__dirname, '..', 'server', 'main.py')]);
  }
  
  pythonProcess.stdout.on('data', (data) => {
    console.log(`Python stdout: ${data}`);
  });
  
  pythonProcess.stderr.on('data', (data) => {
    console.error(`Python stderr: ${data}`);
  });
}

// 在应用启动时启动 Python 后端
app.whenReady().then(() => {
  createWindow();
  startPythonBackend();
});

// 在应用退出时关闭 Python 后端
app.on('will-quit', () => {
  if (pythonProcess) {
    process.platform === 'win32' ? require('child_process').exec(`taskkill /pid ${pythonProcess.pid} /f /t`) : pythonProcess.kill();
  }
});
```

#### 4. 打包 Electron 应用

```bash
cd electron
npm install --save-dev electron-builder
npm run build
```

## 注意事项

1. **路径问题**：在打包后的应用中，资源路径会有所不同。确保使用 `process.resourcesPath` 来定位额外资源。

2. **权限问题**：在 macOS 上，打包后的应用可能需要额外的权限。如果遇到权限问题，可以尝试在 `Info.plist` 中添加相应的权限声明。

3. **体积优化**：PyInstaller 打包的 Python 应用体积较大，可以通过以下方式优化：
   - 使用 `--exclude-module` 排除不需要的模块
   - 使用 `--strip` 减小二进制文件大小
   - 使用 UPX 压缩可执行文件（`--upx-dir`）

4. **调试打包问题**：
   - 对于 PyInstaller：使用 `--debug` 选项获取详细日志
   - 对于 electron-builder：设置环境变量 `DEBUG=electron-builder` 获取详细日志

## 常见问题

### 1. Python 后端无法启动

检查以下几点：
- 确保 PyInstaller 打包时包含了所有依赖
- 检查路径是否正确
- 查看应用日志中的错误信息

### 2. 打包后的应用体积过大

Python 环境打包后体积通常较大，可以：
- 使用虚拟环境，只安装必要的依赖
- 使用 PyInstaller 的 `--exclude-module` 排除不需要的模块
- 考虑使用 UPX 压缩（但可能会增加启动时间）

### 3. macOS 代码签名问题

在 macOS 上发布应用需要代码签名：
- 获取 Apple Developer 证书
- 在 electron-builder 配置中添加签名配置
- 使用 `codesign` 工具签名

### 4. 网络连接问题

在中国大陆等地区，下载 Electron 二进制文件可能会遇到网络问题：

- 项目已配置使用国内镜像源（npmmirror.com）
- 如果仍然遇到网络问题，可以尝试：
  - 使用 VPN 或代理
  - 手动下载 Electron 二进制文件并放置在缓存目录
  - 设置环境变量 `ELECTRON_MIRROR` 和 `ELECTRON_BUILDER_BINARIES_MIRROR`
  - 在 `.npmrc` 文件中配置镜像源

## 参考资源

- [PyInstaller 文档](https://pyinstaller.org/en/stable/)
- [electron-builder 文档](https://www.electron.build/)
- [Electron 文档](https://www.electronjs.org/docs)
- [FastAPI 文档](https://fastapi.tiangolo.com/)