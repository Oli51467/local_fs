# Repository Guidelines

## Project Structure & Module Organization
- `server/` hosts the FastAPI backend: routers in `server/api/`, domain logic in `server/service/`, configs in `server/config/`, pytest suites in `server/tests/`.
- `electron/` contains the Electron shell with vanilla JS renderer in `electron/src/` and packaging config; co-located styles live in `electron/src/styles/`.
- `python_backend/` mirrors runtime helpers shipped with releases, while `meta/` caches models and `data/` stores workspace state—inspect locally but keep out of version control.

## Build, Test, and Development Commands
- `python -m venv .venv && source .venv/bin/activate` followed by `pip install -r server/requirements.txt` provisions pinned backend dependencies.
- `cd electron && npm install` sets up renderer dependencies; `npm run dev` launches the desktop app against the API (`FS_APP_API_HOST`/`FS_APP_API_PORT`).
- `python -m uvicorn server.main:app --reload --port 8000` serves the backend for debugging; export `FS_APP_API_PORT=8000` so Electron targets it.
- `python package.py` and `npm run build` produce distributable bundles via electron-builder.

## Coding Style & Naming Conventions
- Apply PEP 8, four-space indentation, type hints, and descriptive docstrings; reuse dataclasses such as `server/service/model_manager.py`.
- Name modules snake_case and keep async endpoints verb-based (`mount_documents`, `refresh_index`); log with `logging`, not `print`.
- Frontend scripts use two-space indentation, camelCase methods, and co-located styles; run `npx prettier --write electron/src/**/*.js` before committing.

## Testing Guidelines
- Execute `python -m pytest server/tests -q`; add new suites as `server/tests/test_<feature>.py`.
- Use `-k` to focus slow model checks and guard heavy integrations with `@pytest.mark.skipif`.
- Mock `huggingface_hub` interactions and document new sample assets in `data/README` to keep tests deterministic.

## Commit & Pull Request Guidelines
- Write short, imperative commits scoped per feature (`server: fix reranker weights`, `add ace editor mode`).
- PRs should include a behaviour summary, linked issues, UI screenshots or GIFs when relevant, and the exact test command run.
- Verify `python -m uvicorn ... --reload` and `npm run dev` start cleanly before review; call out required model prefetch steps.

## Security & Configuration Tips
- Keep secrets in `.env`; never commit tokens or cached `meta/` artifacts.
- Clear `meta/` before packaging to avoid shipping large models unintentionally.
