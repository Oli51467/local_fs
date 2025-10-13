This repository (LoFS) is an Electron desktop app with a FastAPI backend focused on local file indexing and multimodal semantic search. Use the notes below to make targeted edits and to implement features quickly.

Key architecture and components
- Frontend: `electron/` — vanilla Electron app. Main packaging config: `electron/package.json`.
- Backend: `server/` — FastAPI app centered at `server/main.py`. Services live under `server/service/`, API routers under `server/api/`, and Pydantic models under `server/model/`.
- Packaging: `package.py` and `build.sh` orchestrate freezing the Python backend (PyInstaller) and building the Electron bundle. Packaging relies on `meta/` and `data/` runtime directories.
- Models & assets: `meta/` holds downloaded model weights and persistent vector/index files. Paths are configured in `server/config/config.py` and can be overridden via FS_APP_* env vars.

Quick developer workflows (concrete commands)
- Install backend deps: `python -m venv venv && source venv/bin/activate && pip install -r server/requirements.txt`.
- Run backend in dev: `python server/main.py` (uses Uvicorn internally). Health check: `GET /api/health/ready`.
- Run frontend dev: `cd electron && npm install && npm run dev` (or `npm run start` depending on local setup).
- Package app (all platforms): `python package.py` (see `--help` flags). Helper: `./build.sh`.

Project-specific patterns and conventions
- Initialization: `server/main.py` uses an async lifespan to eagerly initialize model managers, BM25, Faiss, SQLite, embedders and reranker. Prefer using `init_*` helpers (e.g. `init_chat_api`, `init_document_api`) when wiring services in tests or new modules.
- Config overrides: runtime paths are read from `server/config/config.py`. Use the FS_APP_EXTERNAL_ROOT, FS_APP_DATA_DIR and FS_APP_META_DIR environment variables to rebase project and meta/data locations (important for packaged builds).
- Long-running tasks: PDF parsing and document uploads use background tasks and an in-memory task registry (`api/document_api.py` _pdf_parse_tasks). Keep threading and temp-dir cleanup in mind when modifying parsing code.
- Retrieval flow: search pipelines merge dense (Faiss), lexical (BM25s) and reranker scores in `api/chat_api.py`. When changing ranking weights, update constants near the top of that file (e.g. RERANK_FUSION_WEIGHT).
- File handling: `document_api.py` normalizes markdown and resolves local image references; image extraction and size checks are centralized there.

Integration points & external dependencies
- HuggingFace models are lazily downloaded by `service/model_manager.py`. Pre-download via the snippet in `README_EN.md` if you need offline or repeatable tests.
- Native/compiled libs: `faiss-cpu` and some model backends require compatible platforms and may fail in CI without appropriate wheel support.
- Packaging hooks: `package.py` creates a PyInstaller runtime hook that rebinds config paths at runtime; ensure changes to `config.py` and `package.py` stay coordinated.

What to look for when making changes
- Tests under `server/tests/` use FastAPI's TestClient—follow their setup patterns when adding new API tests.
- Keep CORS and health endpoints in `server/main.py` consistent when adding new routers.
- Avoid hard-coding paths; prefer `ServerConfig`/`DatabaseConfig` or FS_APP_* env vars so packaged apps keep working.

Examples (copy-paste friendly)
- Start backend dev server (local): `python server/main.py`
- Health check: `curl -s http://localhost:8000/api/health/ready | jq` (expect JSON with ready flag)
- Pre-download models: see README_EN.md snippet using `service.model_manager.get_model_manager()`.

If something's missing or ambiguous here, tell me which API, service, or packaging detail you'd like expanded and I'll iterate.
