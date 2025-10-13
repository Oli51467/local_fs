Purpose
-------
This document provides a concise, high-signal prompt template for code-writing agents (Codex-style or similar) working on the LoFS repository. Use it as a starting point for task-specific prompts; it emphasizes local project conventions, runtime expectations, and examples of where to make changes.

How to use
----------
- Paste the template below at the top of your prompt when asking the model to change code in this repo.
- Keep the instruction portion short and precise. Supply file paths, test names, and minimal reproduction steps where possible.

Template
--------
You are an expert software engineer familiar with Python (FastAPI), Electron (Node.js), and packaging with PyInstaller/electron-builder. Apply the repository's conventions when making edits. Always:

- Read the files mentioned before changing anything; do not invent new files or paths unless asked.
- Prefer changing a single file per small fix; keep changes minimal and well-scoped.
- Preserve existing coding style and docstrings.
- Use `ServerConfig` / `DatabaseConfig` and FS_APP_* env vars for paths instead of hard-coded paths.
- When adding runtime behavior, ensure tests under `server/tests/` can be adapted and run with FastAPI's TestClient.

Important repo notes (copy into prompt for context)
- Backend entrypoint: `server/main.py` (FastAPI app, async lifespan, health endpoint at `/api/health/ready`).
- Services: `server/service/` — embedding, faiss, bm25s, reranker, sqlite managers. Use `init_*` helpers to wire services.
- Document API: `server/api/document_api.py` — complex file I/O, markdown/image resolution, PDF/PPTX parsing.
- Chat & retrieval: `server/api/chat_api.py` — dense + lexical + reranker fusion; ranking constants live near top of file.
- Packaging: `package.py` — creates PyInstaller runtime hook and spec; `electron/package.json` contains packaging scripts.

When editing code
-----------------
- If modifying config values, put them in `server/config/config.py` and respect `_load_runtime_overrides()`.
- For changes affecting packaging or runtime paths, update `package.py` hooks accordingly.
- For I/O or parsing changes (PDF, DOCX, PPTX), pay attention to temporary directories and cleanup in `document_api.py`.
- If adding new third-party dependencies, update `server/requirements.txt` and note native-compiled packages (Faiss, torch) that may fail in CI.

Testing & debugging
-------------------
- Run backend locally:
```bash
python server/main.py
```
- Tests live in `server/tests/` and use FastAPI's TestClient.
- Health check endpoint: `GET /api/health/ready` — useful to confirm service init.

Response format
---------------
When asked to produce edits, return a git-style patch (or list of changed files with concise rationale) and a minimal test or manual verification steps. If uncertain about a detail, ask one targeted question rather than guessing.

Example micro-instruction (append when asking for a change)
-------------------------------------------------------
Task: "Reduce reranker fusion weight from 0.6 to 0.5 in `server/api/chat_api.py` and add a unit test asserting the fusion calculation uses the new weight."

Final note
----------
Keep prompts focused. This template is meant to be combined with the exact files, lines, and tests you want the model to modify.
---
mode: agent
---
Define the task to achieve, including specific requirements, constraints, and success criteria.