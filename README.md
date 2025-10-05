# 🗂️ LoFS · Load once Fast Search

[English](README_EN.md) ｜ **中文**

LoFS（Load once Fast Search）是一款面向本地知识库的桌面级文件管理与语义检索工具。“加载一次，快速搜索” 是它的核心理念：只需挂载一次，随时获得毫秒级的全文与语义搜索体验。

## ✨ 核心特性
- 🔍 **一次挂载，极速搜索**：自动解析 Markdown、TXT、Word、PDF 等格式，向量化存储文本与图片内容。
- 📁 **现代化文件树交互**：支持右键挂载/取消挂载、PDF 专属解析、解析进度实时可视化。
- 🧠 **混合检索引擎**：结合 Faiss 向量索引、BM25s 关键词召回与重排序模型，实现精准结果。
- 🔒 **本地优先**：所有文件、向量与索引均保存在本地 SQLite 与 Faiss，中断网络也可使用。
- 🛠️ **开箱即用的桌面应用**：Electron 桌面端 + FastAPI 后端的双核架构，支持多平台打包。

## 📸 界面一览
| 欢迎页 | PDF 解析 | 搜索结果 |
|:--:|:--:|:--:|
| ![欢迎页面](img/welcome_page.png) | ![PDF查看器](img/pdf_viewer.png) | ![PPT查看器](img/ppt_viewer.png) |

## 🧭 项目简介
LoFS 将传统文件管理与现代语义检索融合，创新点包括：
- **单次挂载 + 持久化向量库**：降低重复解析、重复嵌入的成本。
- **文本 + 图片双模态**：提取 Markdown/Word/PDF 中的图片并进行 CLIP 向量化，实现图文混合检索。
- **解析工作流可视化**：挂载、解析、重挂载的全过程都有实时进度与成功提示。

## 🚀 快速开始
### ✅ 环境要求
| 组件 | 最低版本 | 推荐 |
| --- | --- | --- |
| Python | 3.8 | 3.10+ |
| Node.js | 16 | 18+ |
| npm | 8 | 最新稳定版 |
| 操作系统 | Windows / macOS / Linux | — |

### ⚙️ 安装步骤
```bash
# 克隆仓库
git clone <repository-url>
cd LocalFS

# 后端依赖
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r server/requirements.txt

# 前端依赖
cd electron
npm install
```

### ▶️ 启动项目
```bash
# 终端 1：启动 FastAPI 后端
python server/main.py

# 终端 2：启动 Electron 前端
cd electron
npm run dev
```

### 📦 打包桌面应用
```bash
python package.py        # 一键打包
./build.sh               # macOS / Linux 快捷脚本
build.bat                # Windows 快捷脚本
```

## 📦 模型资源管理
- 应用启动时会自动在 `meta` 目录下创建模型占位目录：
  - `embedding/bge-m3`
  - `reranker/bge-reranker-v3-m3`
  - `embedding/clip`
  - `pdf-extract-kit`
- 当首次使用对应功能（向量化、重排、图像检索、PDF 解析）时，会通过 `huggingface_hub` 自动拉取模型文件。
- 如需提前下载，可执行：
  ```bash
  python -c "from service.model_manager import get_model_manager; get_model_manager().get_model_path('bge_m3'); get_model_manager().get_model_path('bge_reranker_v2_m3'); get_model_manager().get_model_path('clip_vit_b_32'); get_model_manager().get_model_path('pdf_extract_kit')"
  ```
- 即便清空 `meta` 目录，应用在启动时也会重新创建所需目录。

## 🧱 技术栈概览
- **前端**：Electron · 原生 HTML/CSS/JavaScript · Axios
- **后端**：FastAPI · Pydantic · Uvicorn
- **检索**：Faiss · BM25s · FlagEmbedding (BGE 系列) · CLIP
- **存储**：SQLite · 本地文件系统

---
LoFS = Local File System + Load once Fast Search — 让本地文件的检索体验 “加载一次，搜索即达”。
