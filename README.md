# 🗂️ LoFS · Load once Fast Search

[English](README_EN.md) ｜ **中文**

LoFS（Load once Fast Search）是一款面向本地知识库的桌面级文件管理与信息检索APP。只需挂载一次，随时获得秒级的全文与语义搜索体验。

## ✨ 核心特性
- 🔍 **多模态处理**：自动解析.markdown、.txt、.docx、.pdf、.pptx、.json等类型的文件，随时存储文本与图片内容。
- 📁 **文件树交互**：支持一键挂载、一键PDF解析、解析进度实时可视化。
- 🧠 **混合检索**：结合 Faiss 向量索引、BM25s 关键词召回与reranker重排序模型，实现精准检索。
- 🔒 **本地优先**：所有文件、向量与索引均保存在本地 SQLite 与 Faiss，核心数据不出域
- 🛠️ **开箱即用**：Electron 桌面端 + FastAPI 后端的双核架构，支持多平台打包。

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
cd electron
npm run dev
```

### 📦 打包应用
```bash
python package.py        # 一键打包
```

## 📦 模型资源管理
- 应用启动时会自动在 `meta` 目录下创建模型目录：
  - `embedding/bge-m3`
  - `embedding/clip`
  - `reranker/bge-reranker-v3-m3`
  - `pdf-extract-kit`
- 当首次使用对应功能（向量化、重排、图像检索、PDF 解析）时，会通过 `huggingface_hub` 自动拉取模型文件。
- 即便清空 `meta` 目录，应用在启动时也会重新创建所需目录。
