@echo off
echo === Electron + Python 应用打包脚本 ===
echo.

REM 检查Python是否安装
python --version >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo 错误: 未找到Python，请先安装Python
    exit /b 1
)

REM 检查pip是否安装
pip --version >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo 错误: 未找到pip，请先安装pip
    exit /b 1
)

REM 检查Node.js是否安装
node --version >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo 错误: 未找到Node.js，请先安装Node.js
    exit /b 1
)

REM 检查npm是否安装
npm --version >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo 错误: 未找到npm，请先安装npm
    exit /b 1
)

echo 安装Python依赖...
pip install -r server\requirements.txt
pip install pyinstaller

echo 安装Electron依赖...
cd electron
npm install
cd ..

echo 开始打包应用...

REM 设置环境变量以使用国内镜像
set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
set ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/

python package.py

echo.
echo 打包完成！应用位于 electron\dist\ 目录