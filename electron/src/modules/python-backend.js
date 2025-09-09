const path = require('path');
const { spawn, execFile, exec } = require('child_process');

class PythonBackendModule {
  constructor() {
    this.pythonProcess = null;
  }

  startPythonBackend() {
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
      this.pythonProcess = spawn(pythonExecutablePath, [path.join(__dirname, '..', '..', '..', 'server', 'main.py')]);
      
      this.pythonProcess.stdout.on('data', (data) => {
        console.log(`Python stdout: ${data}`);
      });
      
      this.pythonProcess.stderr.on('data', (data) => {
        console.error(`Python stderr: ${data}`);
      });
      
      this.pythonProcess.on('close', (code) => {
        console.log(`Python process exited with code ${code}`);
      });
      
      return;
    }
    
    // 在生产环境中运行打包后的Python可执行文件
    this.pythonProcess = execFile(pythonExecutablePath);
    
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