# 🗂️ LoFS - Load once Fast Search

> **Lo**cal **F**ile **S**ystem + Load once Fast Search - 基于向量搜索和RAG技术的现代化桌面文件管理解决方案
>
> 🎯 **LoFS** 巧妙融合：作为 **Local File System** 体现其本地文件系统的本质，同时通过 **Load once Fast Search** 彰显其一次加载、极速搜索的核心能力

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Python](https://img.shields.io/badge/Python-3.8+-green.svg)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.104+-red.svg)](https://fastapi.tiangolo.com/)
[![Electron](https://img.shields.io/badge/Electron-26+-blue.svg)](https://www.electronjs.org/)

## 🎯 核心特性

### 🔍 智能文档处理
- **多格式支持**：TXT、PDF、Excel文件智能解析
- **向量化存储**：基于BAAI/bge-small-zh-v1.5的文档嵌入
- **混合检索**：结合向量搜索(Faiss)和关键词搜索(BM25s)
- **智能重排序**：Cross-Encoder模型优化搜索结果

### 🏗️ 现代化架构
- **双核架构**：LoFS = Local File System (本地文件系统) + Load once Fast Search (一次加载极速搜索)
- **前后端分离**：Electron + FastAPI架构
- **模块化设计**：可插拔的服务架构
- **异步处理**：支持大文件并发处理
- **本地优先**：完全离线的文档处理能力

### 🛠️ 工程化实践
- **容器化部署**：支持Docker容器化
- **自动化构建**：一键打包多平台应用
- **配置管理**：环境变量驱动的配置系统
- **日志监控**：完整的日志和监控体系

## 📸 系统演示

### 🎨 现代化界面
LoFS采用简洁现代的设计风格，提供直观的用户体验：

| ![欢迎页面](img/welcome_page.png) |
|:--:|
| *LoFS启动欢迎页面 - 简洁优雅的品牌展示* |

### 📄 智能文档查看
支持多种文档格式的智能解析和优雅展示：

| ![PDF查看器](img/pdf_viewer.png) |
|:--:|
| *PDF文档智能解析 - 支持文本提取和向量化处理* |

| ![PPT查看器](img/ppt_viewer.png) |
|:--:|
| *PowerPoint文档处理 - 智能内容识别和结构化展示* |

### 🔍 核心功能亮点
- **📁 智能文件树**：直观的资源管理器界面
- **🔎 极速搜索**：毫秒级向量搜索响应
- **📊 数据库管理**：内置数据库管理面板
- **⚙️ 系统配置**：灵活的配置管理系统

## 🚀 快速开始

### 环境要求
```bash
# Python环境
Python 3.8+  # 推荐3.10+
Node.js 16+  # 推荐18+

# 系统依赖
macOS/Linux: 原生支持
Windows: 需要Visual C++ 14.0+
```

### 安装部署

```bash
# 1. 克隆项目
git clone <repository-url>
cd LocalFS

# 2. 后端环境准备
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r server/requirements.txt

# 3. 前端环境准备
cd electron
npm install

# 4. 开发模式启动
# 终端1 - 启动后端
python server/main.py

# 终端2 - 启动前端
cd electron
npm run dev
```

### 生产构建

```bash
# 一键打包脚本
python package.py

# 构建产物位置
electron/dist/  # 各平台安装包
```

## 📊 系统架构

### 技术栈
```
┌─────────────────────────────────────────────────────────┐
│                    Electron Frontend                   │
├─────────────────────────────────────────────────────────┤
│  • HTML5/CSS3/JavaScript (ES6+)                      │
│  • Axios HTTP客户端                                   │
│  • 原生文件系统API                                     │
└─────────────────────┬───────────────────────────────────┘
                      │ IPC通信
┌─────────────────────┴───────────────────────────────────┐
│                  FastAPI Backend                      │
├─────────────────────────────────────────────────────────┤
│  API层                                                  │
│  ├── document_api.py  - 文档上传处理                      │
│  ├── database_api.py  - 数据库操作                       │
│  ├── faiss_api.py    - 向量索引管理                     │
│  └── cleanup_api.py  - 系统清理维护                     │
│                                                         │
│  服务层                                                  │
│  ├── embedding_service.py    - BAAI嵌入模型             │
│  ├── faiss_service.py        - 向量索引管理              │
│  ├── sqlite_service.py       - 元数据存储               │
│  ├── bm25s_service.py       - 关键词搜索               │
│  ├── reranker_service.py    - 结果重排序               │
│  └── text_splitter_service.py - 文本分块处理            │
└─────────────────────────────────────────────────────────┘
```

### 数据流
```
文档上传 → 文本提取 → 智能分块 → 向量化 → 存储索引
    ↓                                           ↓
文件元数据 ← SQLite存储 ← 内容哈希 ← 格式检测
```

## 🔧 核心API

### 文档管理
```http
POST /api/document/upload          # 文档上传
POST /api/document/delete          # 文档删除  
POST /api/document/reupload        # 重新上传
POST /api/document/update-path       # 路径更新
```

### 搜索检索
```http
POST /api/faiss/search             # 向量搜索
POST /api/database/search          # 数据库查询
POST /api/faiss/bm25s_search       # BM25s关键词搜索
```

### 系统管理
```http
GET  /api/health/ready             # 健康检查
POST /api/cleanup/all              # 系统清理
GET  /api/cleanup/status           # 清理状态
```

## 🎛️ 配置系统

### 环境变量
```bash
# 核心配置
PROJECT_ROOT=/path/to/project       # 项目根目录
SERVER_HOST=0.0.0.0                 # 服务地址
SERVER_PORT=8000                     # 服务端口

# 模型配置
EMBEDDING_MODEL=BAAI/bge-small-zh-v1.5 # 嵌入模型
RERANKER_MODEL=BAAI/bge-reranker-base # 重排序模型

# 存储配置
SQLITE_DB_PATH=data/documents.db     # SQLite路径
VECTOR_INDEX_PATH=data/faiss.index   # 向量索引路径
DATABASE_DIR=data/                    # 数据目录

# 分块策略
TEXT_SPLITTER_TYPE=recursive         # recursive|semantic
RECURSIVE_CHUNK_SIZE=512            # 分块大小
RECURSIVE_CHUNK_OVERLAP=50          # 重叠大小
```

## 📈 性能指标

### 处理能力
- **文档处理**：支持100MB+大文件处理
- **并发处理**：异步处理，支持多文件并发
- **搜索性能**：毫秒级向量搜索响应
- **内存优化**：流式处理，内存占用可控

### 扩展性
- **水平扩展**：支持多实例部署
- **存储扩展**：支持TB级文档存储
- **模型热切换**：支持模型动态更新
- **插件扩展**：预留插件接口

## 🔒 安全设计

### 数据安全
- **本地存储**：所有数据本地处理，无云端依赖
- **路径验证**：严格的文件路径验证机制
- **内容检测**：恶意文件检测和处理
- **权限控制**：基于文件系统的权限管理

### 系统安全
- **输入验证**：完整的参数验证和清洗
- **错误处理**：统一的异常处理机制
- **日志审计**：完整的操作日志记录
- **资源限制**：内存和CPU使用限制

## 🧪 开发规范

### 代码质量
```bash
# 代码格式化
black server/                    # Python代码格式化
prettier electron/               # JavaScript代码格式化

# 静态检查
pylint server/                   # Python代码检查
eslint electron/                 # JavaScript代码检查
```

### 测试覆盖
```bash
# 单元测试
python -m pytest server/tests/   # 后端测试
npm test electron/               # 前端测试

# 集成测试
python server/tests/integration/ # 集成测试
```

## 📋 路线图

### v1.0 (当前)
- ✅ 基础文档管理功能
- ✅ 向量搜索实现
- ✅ 混合检索策略
- ✅ 多平台打包支持

### v1.1 (近期)
- 🔄 PDF解析优化
- 🔄 Excel数据处理增强
- 🔄 语义分块策略
- 🔄 搜索性能优化

### v2.0 (中期)
- 📋 多模态文档支持
- 📋 图数据库集成
- 📋 分布式架构支持
- 📋 插件生态系统

### v3.0 (愿景)
- 🎯 AI Agent集成
- 🎯 知识图谱构建
- 🎯 智能推荐系统
- 🎯 企业级特性

## 🤝 贡献指南

### 开发流程
1. Fork项目并创建功能分支
2. 遵循代码规范进行开发
3. 添加测试用例
4. 提交Pull Request
5. 通过代码审查

### 提交规范
```
feat: 新功能开发
fix: 问题修复
docs: 文档更新
style: 代码格式
refactor: 代码重构
test: 测试用例
chore: 构建维护
```

## 📄 许可证

MIT License - 详见 [LICENSE](LICENSE) 文件

## 🙏 致谢

### 核心技术
- **[FastAPI](https://fastapi.tiangolo.com/)** - 高性能Web框架
- **[Faiss](https://github.com/facebookresearch/faiss)** - Facebook向量搜索库
- **[BAAI](https://github.com/FlagOpen/FlagEmbedding)** - 智源研究院嵌入模型
- **[Electron](https://www.electronjs.org/)** - 跨平台桌面应用框架

### 开源生态
感谢所有为开源社区贡献的项目和开发者，LoFS (Local File System) 站在巨人的肩膀上前行。

---

<div align="center">

**LoFS** (Local File System + Load once Fast Search) - 重新定义本地文件管理体验

[📖 文档](https://github.com/your-username/LoFS/wiki) • [🐛 报告问题](https://github.com/your-username/LoFS/issues) • [💡 功能建议](https://github.com/your-username/LoFS/discussions)

</div>