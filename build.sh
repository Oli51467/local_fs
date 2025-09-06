#!/bin/bash

# 确保脚本在错误时退出
set -e

echo "=== Electron + Python 应用打包脚本 ==="
echo ""

# 检查Python是否安装
if ! command -v python3 &> /dev/null; then
    echo "错误: 未找到Python3，请先安装Python3"
    exit 1
fi

# 检查pip是否安装
if ! command -v pip3 &> /dev/null; then
    echo "错误: 未找到pip3，请先安装pip3"
    exit 1
fi

# 检查Node.js是否安装
if ! command -v node &> /dev/null; then
    echo "错误: 未找到Node.js，请先安装Node.js"
    exit 1
fi

# 检查npm是否安装
if ! command -v npm &> /dev/null; then
    echo "错误: 未找到npm，请先安装npm"
    exit 1
fi

echo "安装Python依赖..."
pip3 install -r server/requirements.txt
pip3 install pyinstaller

echo "安装Electron依赖..."
cd electron
npm install
cd ..

echo "开始打包应用..."

# 设置环境变量以使用国内镜像
export ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
export ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/"

python3 package.py

echo ""
echo "打包完成！应用位于 electron/dist/ 目录"