# 🗂️ LocalFS - 智能桌面文件管理系统

> 一个现代化的本地文件管理解决方案，集成AI能力，让文件管理更智能、更高效

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Electron](https://img.shields.io/badge/Electron-Latest-blue.svg)](https://www.electronjs.org/)
[![Python](https://img.shields.io/badge/Python-3.8+-green.svg)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-Latest-red.svg)](https://fastapi.tiangolo.com/)

## 🌟 背景介绍

在数字化时代，我们每天都要处理大量的文件和文档。传统的文件管理器功能单一，无法满足现代工作流程的需求。LocalFS 应运而生，它不仅是一个文件管理器，更是一个智能的文件处理平台。

**LocalFS** 致力于打造下一代桌面文件管理体验：
- 🎯 **专注本地**：专为本地文件管理优化，无需云端依赖
- 🤖 **AI 驱动**：集成大模型能力，智能分析文档内容
- 🔧 **高度可扩展**：模块化设计，支持多种文件格式处理
- 💡 **用户友好**：直观的界面设计，简化复杂操作

## ✨ 主要功能

### 📁 智能文件管理
- **可视化文件树**：直观的树形结构展示，支持拖拽调整
- **快速导入**：一键导入各种类型文件到工作区
- **批量操作**：支持文件/文件夹的批量创建、删除、重命名
- **智能搜索**：基于文件名、内容的快速检索

### 🤖 AI 文档处理
- **PDF 智能解析**：自动将 PDF 转换为 Markdown 格式
- **内容理解**：利用大模型分析文档内容，提取关键信息
- **智能摘要**：自动生成文档摘要和关键词标签
- **语义搜索**：基于内容语义的智能搜索功能

### 📊 数据分析能力
- **Excel 文件支持**：上传并解析 .xlsx/.xls 文件
- **数据可视化**：自动生成图表和统计报告
- **数据洞察**：AI 驱动的数据分析和趋势识别
- **报告生成**：一键生成专业的数据分析报告

### 🎨 现代化界面
- **响应式设计**：适配不同屏幕尺寸
- **暗色模式**：护眼的深色主题支持
- **自定义布局**：可调整的面板和工具栏
- **快捷操作**：丰富的键盘快捷键支持

### 🔧 扩展功能
- **插件系统**：支持第三方插件扩展
- **格式转换**：多种文件格式间的智能转换
- **版本管理**：文件变更历史追踪
- **云端同步**：可选的云端备份功能（规划中）

## 🛠️ 技术栈

### 前端技术
- **Electron**：跨平台桌面应用框架
- **HTML5/CSS3**：现代化的用户界面
- **JavaScript (ES6+)**：交互逻辑和状态管理
- **SVG Icons**：矢量图标系统

### 后端技术
- **Python 3.8+**：核心业务逻辑
- **FastAPI**：高性能异步 Web 框架
- **PyPDF2/pdfplumber**：PDF 文件解析
- **pandas/openpyxl**：Excel 数据处理
- **transformers**：大模型集成（规划中）

### 系统架构
```
┌─────────────────┐    IPC     ┌─────────────────┐
│   Electron UI   │ ◄────────► │  Python Backend │
│                 │            │                 │
│ • 文件树展示     │            │ • 文件处理       │
│ • 用户交互       │            │ • AI 分析        │
│ • 界面渲染       │            │ • 数据转换       │
└─────────────────┘            └─────────────────┘
```

## 🚀 部署与打包

### 快速开始

1. **环境准备**
```bash
# 安装 Node.js 和 Python 3.8+
# 克隆项目
git clone <repository-url>
cd LocalFS
source .venv/bin/activate 
```

2. **安装依赖**
```bash
# 安装 Python 依赖
pip install -r server/requirements.txt

# 安装 Electron 依赖
cd electron
npm install
```

3. **开发模式运行**
```bash
# 启动后端服务
python server/main.py

# 启动 Electron 应用
cd electron
npm run electron:de
```

### 打包发布

使用自动化打包脚本：
```bash
python package.py
```

打包后的应用位于 `electron/dist/` 目录，支持 Windows、macOS 和 Linux 平台。

## 📋 TODO

### 🎯 近期计划 (v1.0)
- [x] 基础文件树展示
- [x] 文件导入/删除功能
- [x] 用户界面优化
- [ ] 文件内容预览
- [ ] 多种文件格式支持
- [ ] 搜索功能实现

### 🚀 中期目标 (v2.0)
- [ ] PDF 转 Markdown 功能
- [ ] Excel 文件解析与展示
- [ ] 基础数据可视化
- [ ] 文件标签系统
- [ ] 快捷键支持
- [ ] 主题切换功能

### 🌟 长期愿景 (v3.0+)
- [ ] 大模型集成 (GPT/Claude)
- [ ] 智能文档分析
- [ ] 语义搜索功能
- [ ] 插件系统架构
- [ ] 云端同步支持
- [ ] 多语言国际化
- [ ] 移动端适配

---

## 🤝 贡献指南

欢迎提交 Issue 和 Pull Request！请确保：
- 遵循现有代码风格
- 添加必要的测试用例
- 更新相关文档

## 📄 许可证

MIT License - 详见 [LICENSE](LICENSE) 文件

## 🙏 致谢

感谢所有开源项目的贡献者，特别是：
- Electron 团队
- FastAPI 社区
- Python 生态系统

---

<div align="center">

**LocalFS** - 让文件管理更智能 🚀

[报告问题](https://github.com/your-username/LocalFS/issues) • [功能建议](https://github.com/your-username/LocalFS/issues) • [参与讨论](https://github.com/your-username/LocalFS/discussions)

</div>