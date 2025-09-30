# LoFS - Load once Fast Search

LoFS（Load once Fast Search）是一款面向本地文件的智能检索与管理桌面应用，让「一次加载，快速搜索」成为日常工作流的默认体验。

## 核心特性
- **一次挂载，快速搜索**：多格式文件统一解析并向量化，挂载后即可进行毫秒级语义检索。
- **智能解析**：原生支持 Markdown、TXT、Word、PDF 等文档，自动提取文本与图片，并生成结构化片段。
- **本地优先**：全部数据落地本地 SQLite 与 Faiss，离线环境亦可完成检索与管理。
- **可视化操作**：Electron 桌面端提供文件树、右键菜单、解析进度条、挂载状态等直观反馈。

## 项目介绍
LoFS 结合 Electron + FastAPI 双端架构，将传统文件管理与现代向量检索融合在一起：
- 通过批量挂载文件夹、右键解析 PDF 等方式快速构建知识库。
- 前端实时展示解析进度、挂载结果并支持智能提示。
- 创新地将一次挂载与多模态（文本、图片）向量存储结合，降低重复处理成本。

## 快速部署
### 环境准备
```bash
python -m venv venv
source venv/bin/activate        # Windows 请使用: venv\Scripts\activate
pip install -r server/requirements.txt

cd electron
npm install
```

### 开发模式启动
```bash
# 终端 1：启动 FastAPI 后端
python server/main.py

# 终端 2：启动 Electron 前端
cd electron
npm run dev
```

### 打包发行
```bash
# 生成桌面端安装包
python package.py
# 或使用脚本
./build.sh        # macOS / Linux
build.bat         # Windows
```

## 技术栈
- **前端**：Electron、原生 HTML/CSS/JavaScript
- **后端**：FastAPI、Pydantic、Uvicorn
- **搜索**：Faiss、BM25s、FlagEmbedding (BGE 系列)
- **数据存储**：SQLite、局部文件系统

---
想要一套「加载一次、搜索即达」的本地知识库？LoFS 就是为此而生。
