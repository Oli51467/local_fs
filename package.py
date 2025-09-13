# package.py
import os
import sys
import platform
import subprocess
import shutil

def run_command(command):
    print(f"执行命令: {command}")
    process = subprocess.Popen(command, shell=True)
    process.wait()
    if process.returncode != 0:
        print(f"命令执行失败: {command}")
        sys.exit(1)

def run_command_with_env(command, env_vars):
    print(f"执行命令: {command}")
    process = subprocess.Popen(command, shell=True, env=env_vars)
    process.wait()
    if process.returncode != 0:
        print(f"命令执行失败: {command}")
        sys.exit(1)

def package_python_backend():
    print("\n=== 打包Python后端 ===\n")
    
    # 确保PyInstaller已安装
    run_command("pip install pyinstaller")
    
    # 创建spec文件
    spec_content = '''
# -*- mode: python ; coding: utf-8 -*-

block_cipher = None

a = Analysis(
    ['server/main.py'],
    pathex=[],
    binaries=[],
    datas=[],
    hiddenimports=['uvicorn.logging', 'uvicorn.protocols', 'uvicorn.protocols.http', 'uvicorn.protocols.http.auto', 'uvicorn.protocols.websockets', 'uvicorn.protocols.websockets.auto', 'uvicorn.lifespan', 'uvicorn.lifespan.on', 'uvicorn.lifespan.off'],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='python_backend',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='python_backend',
)
'''
    
    with open('python_backend.spec', 'w') as f:
        f.write(spec_content)
    
    # 运行PyInstaller
    run_command("pyinstaller python_backend.spec")
    
    # 移动打包后的Python后端到electron目录
    if os.path.exists('electron/python_backend'):
        shutil.rmtree('electron/python_backend')
    shutil.move('dist/python_backend', 'electron/python_backend')
    
    # 清理临时文件
    if os.path.exists('build'):
        shutil.rmtree('build')
    if os.path.exists('dist'):
        shutil.rmtree('dist')
    os.remove('python_backend.spec')

def update_electron_files():
    print("\n=== 更新Electron文件以支持打包 ===\n")
    
    # 更新main.js以启动打包后的Python后端
    main_js_path = 'electron/main.js'
    with open(main_js_path, 'r') as f:
        main_js_content = f.read()
    
    # 添加启动Python后端的代码
    python_start_code = '''
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
'''
    
    # 替换原来的app.whenReady()部分
    updated_main_js = main_js_content.replace(
        "app.whenReady().then(createWindow);",
        python_start_code
    )
    
    with open(main_js_path, 'w') as f:
        f.write(updated_main_js)
    
    # 更新renderer.js以连接Python后端API
    renderer_js_path = 'electron/renderer.js'
    with open(renderer_js_path, 'r') as f:
        renderer_js_content = f.read()
    
    # 添加连接Python后端的代码
    python_api_code = '''
// 连接Python后端API
async function testPythonBackend() {
  try {
    const response = await fetch('http://127.0.0.1:8000/health');
    const data = await response.json();
    console.log('Python后端健康检查:', data);
    return data;
  } catch (error) {
    console.error('无法连接到Python后端:', error);
    return null;
  }
}

// 在初始化时测试Python后端连接
(async () => {
  // 等待Python后端启动
  setTimeout(async () => {
    await testPythonBackend();
  }, 2000);
  
  // 渲染图标
  renderIcons();
  
  // 初始化拖拽调整功能
  initResizer();
  
  // 获取文件树
  const tree = await window.fsAPI.getFileTree();
  fileTreeEl.innerHTML = '';
  renderTree(tree, fileTreeEl);
  
  // 默认显示文件页面
  showFilePage();
})();
'''
    
    # 替换原来的初始化部分
    updated_renderer_js = renderer_js_content.replace(
        "// 初始化\n(async () => {\n  // 渲染图标\n  renderIcons();\n  \n  // 初始化拖拽调整功能\n  initResizer();\n  \n  // 获取文件树\n  const tree = await window.fsAPI.getFileTree();\n  fileTreeEl.innerHTML = '';\n  renderTree(tree, fileTreeEl);\n  \n  // 默认显示文件页面\n  showFilePage();\n})();",
        python_api_code
    )
    
    with open(renderer_js_path, 'w') as f:
        f.write(updated_renderer_js)

def create_electron_builder_config():
    print("\n=== 创建Electron Builder配置 ===\n")
    
    # 创建package.json文件
    package_json_path = 'electron/package.json'
    with open(package_json_path, 'r') as f:
        package_json = f.read()
    
    # 更新package.json以支持electron-builder
    updated_package_json = '''
{
  "name": "electron-python-app",
  "version": "0.1.0",
  "description": "Electron + Python (FastAPI) desktop app demo",
  "main": "main.js",
  "scripts": {
    "start": "electronmon .",
    "dev": "npm run start",
    "build": "electron-builder build",
    "build:mac": "electron-builder build --mac",
    "build:win": "electron-builder build --win",
    "build:linux": "electron-builder build --linux"
  },
  "build": {
    "appId": "com.electron.python.app",
    "productName": "Electron Python App",
    "files": [
      "**/*",
      "!**/node_modules/*/{CHANGELOG.md,README.md,README,readme.md,readme}",
      "!**/node_modules/*/{test,__tests__,tests,powered-test,example,examples}",
      "!**/node_modules/*.d.ts",
      "!**/node_modules/.bin",
      "!**/*.{iml,o,hprof,orig,pyc,pyo,rbc,swp,csproj,sln,xproj}",
      "!.editorconfig",
      "!**/._*",
      "!**/{.DS_Store,.git,.hg,.svn,CVS,RCS,SCCS,.gitignore,.gitattributes}",
      "!**/{__pycache__,thumbs.db,.flowconfig,.idea,.vs,.nyc_output}",
      "!**/{appveyor.yml,.travis.yml,circle.yml}",
      "!**/{npm-debug.log,yarn.lock,.yarn-integrity,.yarn-metadata.json}"
    ],
    "extraResources": [
      {
        "from": "python_backend",
        "to": "python_backend",
        "filter": ["**/*"]
      },
      {
        "from": "static",
        "to": "static",
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
    },
    "nsis": {
      "oneClick": false,
      "allowToChangeInstallationDirectory": true
    }
  },
  "devDependencies": {
    "electron": "^26.0.0",
    "electron-builder": "^24.6.4",
    "electronmon": "^2.0.2"
  },
  "dependencies": {
    "axios": "^1.6.0"
  }
}
'''
    
    with open(package_json_path, 'w') as f:
        f.write(updated_package_json)

def package_electron_app():
    print("\n=== 打包Electron应用 ===\n")
    
    # 安装electron-builder
    os.chdir('electron')
    run_command("npm install --save-dev electron-builder")
    
    # 设置环境变量以使用国内镜像
    env_vars = os.environ.copy()
    env_vars['ELECTRON_MIRROR'] = 'https://npmmirror.com/mirrors/electron/'
    env_vars['ELECTRON_BUILDER_BINARIES_MIRROR'] = 'https://npmmirror.com/mirrors/electron-builder-binaries/'
    
    # 根据平台打包
    system = platform.system().lower()
    if system == 'darwin':
        run_command_with_env("npm run build:mac", env_vars)
    elif system == 'windows':
        run_command_with_env("npm run build:win", env_vars)
    elif system == 'linux':
        run_command_with_env("npm run build:linux", env_vars)
    else:
        print(f"不支持的平台: {system}")
        sys.exit(1)
    
    print("\n=== 打包完成 ===\n")
    print("打包后的应用位于: electron/dist/")

def main():
    print("\n=== 开始打包Electron+Python应用 ===\n")
    
    # 确保当前目录是项目根目录
    if not os.path.exists('server') or not os.path.exists('electron'):
        print("错误: 请在项目根目录运行此脚本")
        sys.exit(1)
    
    # 打包Python后端
    package_python_backend()
    
    # 更新Electron文件
    update_electron_files()
    
    # 创建electron-builder配置
    create_electron_builder_config()
    
    # 打包Electron应用
    package_electron_app()

if __name__ == "__main__":
    main()