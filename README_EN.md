# LoFS - Load once Fast Search

LoFS (Load once Fast Search) is a desktop application that turns your local folders into an instantly searchable knowledge base.

## Core Highlights
- **Load once, search fast**: parse and vectorize multiple document formats once, then enjoy millisecond semantic search.
- **Smart parsing**: native support for Markdown, TXT, Word, PDF and more, with automatic text/image extraction and chunking.
- **Local-first**: everything runs offline with SQLite + Faiss, keeping data safely on your machine.
- **Friendly UI**: the Electron client offers a file tree, context menus, PDF parsing progress, and mount status indicators.

## Project Overview
LoFS combines an Electron desktop shell with a FastAPI backend to modernize local file management:
- Batch mount folders or parse PDFs from the context menu to build your knowledge base quickly.
- Real-time progress bars and completion notices guide every document operation.
- Innovative coupling of single-pass mounting with multimodal (text + image) embeddings removes repetitive processing costs.

## Getting Started
### Setup
```bash
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r server/requirements.txt

cd electron
npm install
```

### Development Run
```bash
# Terminal 1 — FastAPI backend
python server/main.py

# Terminal 2 — Electron frontend
cd electron
npm run dev
```

### Packaging
```bash
python package.py        # build desktop installers
./build.sh               # macOS / Linux helper
build.bat                # Windows helper
```

## Tech Stack
- **Frontend**: Electron, vanilla HTML/CSS/JavaScript
- **Backend**: FastAPI, Pydantic, Uvicorn
- **Search**: Faiss, BM25s, FlagEmbedding (BGE family)
- **Storage**: SQLite plus the local filesystem

---
LoFS delivers a “load once, search fast” experience for anyone who wants a powerful yet lightweight local knowledge hub.
