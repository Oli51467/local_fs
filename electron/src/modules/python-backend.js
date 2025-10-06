const fs = require('fs');
const path = require('path');
const http = require('http');
const net = require('net');
const { spawn, execFile, exec } = require('child_process');
const { app, dialog } = require('electron');

class PythonBackendModule {
  constructor(appPaths) {
    this.pythonProcess = null;
    const projectRootFallback = path.resolve(__dirname, '..', '..', '..');
    const fallbackExternal = path.join(projectRootFallback);
    this.appPaths = appPaths || {
      externalRoot: fallbackExternal,
      dataRoot: path.join(fallbackExternal, 'data'),
      metaRoot: path.join(fallbackExternal, 'meta')
    };
    this.reusedBackend = false;
    this.apiPort = this.getApiPort();
    this.apiHost = process.env.FS_APP_API_HOST || '127.0.0.1';
  }

  getRuntimePaths() {
    const externalRoot = this.appPaths?.externalRoot || path.join(__dirname, '..', '..');
    const dataRoot = this.appPaths?.dataRoot || path.join(externalRoot, 'data');
    const metaRoot = this.appPaths?.metaRoot || path.join(externalRoot, 'meta');

    [externalRoot, dataRoot, metaRoot].forEach((target) => {
      try {
        fs.mkdirSync(target, { recursive: true });
      } catch (error) {
        console.error('Failed to ensure runtime directory:', target, error);
      }
    });

    return { externalRoot, dataRoot, metaRoot };
  }

  getApiPort() {
    const candidate = Number(process.env.FS_APP_API_PORT);
    if (Number.isFinite(candidate) && candidate > 0 && candidate < 65536) {
      return candidate;
    }
    return 8000;
  }

  async isBackendResponsive(port = this.apiPort, host = this.apiHost) {
    return new Promise((resolve) => {
      const request = http.get({
        host,
        port,
        path: '/api/health/ready',
        timeout: 800
      }, (response) => {
        response.resume();
        resolve(response.statusCode === 200);
      });

      request.on('timeout', () => {
        request.destroy();
        resolve(false);
      });

      request.on('error', () => resolve(false));
    });
  }

  async isPortAvailable(port = this.apiPort, host = this.apiHost) {
    return new Promise((resolve) => {
      const tester = net.createServer()
        .once('error', (error) => {
          if (tester.listening) {
            tester.close();
          }
          if (error && error.code === 'EADDRINUSE') {
            resolve(false);
          } else {
            resolve(false);
          }
        })
        .once('listening', () => {
          tester.close(() => resolve(true));
        });

      tester.listen(port, host);
    });
  }

  async startPythonBackend() {
    const runtimePaths = this.getRuntimePaths();
    this.apiPort = this.getApiPort();
    this.apiHost = process.env.FS_APP_API_HOST || '127.0.0.1';

    // Detect running backend to avoid duplicate launches
    if (await this.isBackendResponsive(this.apiPort, this.apiHost)) {
      console.log('Python backend already running, reusing existing instance.');
      this.reusedBackend = true;
      return;
    }

    const portAvailable = await this.isPortAvailable(this.apiPort, this.apiHost);
    if (!portAvailable) {
      const message = `后端端口 ${this.apiPort} 已被其他程序占用，无法启动Python服务。请释放该端口后重试。`;
      console.error(message);
      dialog.showErrorBox('Python 后端启动失败', message);
      this.reusedBackend = false;
      return;
    }

    const packagedBackend = process.platform === 'win32'
      ? path.join(process.resourcesPath, 'python_backend', 'python_backend.exe')
      : path.join(process.resourcesPath, 'python_backend', 'python_backend');

    const shouldUsePackagedBackend = app.isPackaged && fs.existsSync(packagedBackend);

    if (shouldUsePackagedBackend) {
      // 在打包后的应用中运行PyInstaller生成的后端可执行文件
      const env = {
        ...process.env,
        FS_APP_EXTERNAL_ROOT: runtimePaths.externalRoot,
        FS_APP_DATA_DIR: runtimePaths.dataRoot,
        FS_APP_META_DIR: runtimePaths.metaRoot,
        FS_APP_API_PORT: String(this.apiPort),
        FS_APP_API_HOST: this.apiHost,
      };

      this.pythonProcess = execFile(packagedBackend, [], {
        cwd: path.dirname(packagedBackend),
        env,
      });
    } else {
      // 在开发环境中，直接运行Python脚本
      const pythonPath = process.platform === 'win32' ? 'python' : 'python3';
      const backendEntry = path.join(__dirname, '..', '..', '..', 'server', 'main.py');

      if (!fs.existsSync(backendEntry)) {
        console.error(`无法找到Python后端入口文件: ${backendEntry}`);
        return;
      }

      const env = {
        ...process.env,
        FS_APP_EXTERNAL_ROOT: runtimePaths.externalRoot,
        FS_APP_DATA_DIR: runtimePaths.dataRoot,
        FS_APP_META_DIR: runtimePaths.metaRoot,
        FS_APP_API_PORT: String(this.apiPort),
        FS_APP_API_HOST: this.apiHost,
      };

      this.pythonProcess = spawn(pythonPath, [backendEntry], {
        cwd: path.join(__dirname, '..', '..', '..', 'server'),
        env,
      });
    }
    
    this.pythonProcess.stdout.on('data', (data) => {
      console.log(`Python stdout: ${data}`);
    });
    
    this.pythonProcess.stderr.on('data', (data) => {
      console.error(`Python stderr: ${data}`);
    });
    
    this.pythonProcess.on('close', (code) => {
      console.log(`Python process exited with code ${code}`);
    });
  }

  stopPythonBackend() {
    if (this.reusedBackend) {
      this.pythonProcess = null;
      this.reusedBackend = false;
      return;
    }

    if (this.pythonProcess) {
      if (process.platform === 'win32') {
        exec(`taskkill /pid ${this.pythonProcess.pid} /f /t`);
      } else {
        this.pythonProcess.kill();
      }
      this.pythonProcess = null;
    }
  }

  getPythonProcess() {
    return this.pythonProcess;
  }
}

module.exports = PythonBackendModule;
