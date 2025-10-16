# Repository Guidelines

## Project Structure & Module Organization
- `electron/` contains the Electron shell, vanilla JS UI in `src/`, and packaging config; `python_backend/` mirrors runtime helpers shipped with releases.
- `server/` hosts the FastAPI backend with routers in `api/`, domain services in `service/`, configs in `config/`, and pytest suites under `tests/`.
- `meta/` caches downloaded models and `data/` captures mounted workspace state; keep them out of version control but inspect them when reproducing user issues.

## Build, Test, and Development Commands
- `python -m venv .venv && source .venv/bin/activate` then `pip install -r server/requirements.txt` installs backend dependencies pinned for FastAPI + retrieval.
- `cd electron && npm install` prepares the desktop client; `npm run dev` boots Electron with live reload while connecting to the API at `FS_APP_API_HOST:FS_APP_API_PORT`.
- `python -m uvicorn server.main:app --reload --port 8000` runs the backend stand-alone for API debugging; export `FS_APP_API_PORT=8000` so the renderer hits it.
- `python -m pytest server/tests -q` executes unit and service tests; prefer `-k matcher` to isolate slow model checks and keep CI under control.
- `python package.py` or `npm run build` assembles distributable bundles using `electron-builder`.

## Coding Style & Naming Conventions
- Follow PEP 8 with four-space indentation, descriptive docstrings, and type hints; reuse dataclass patterns (`server/service/model_manager.py`) and snake_case filenames.
- Keep async endpoints verb-based (`mount_documents`, `refresh_index`) and log with `logging` not `print`.
- Frontend modules use two-space indentation, camelCase methods, and co-located CSS in `electron/src/styles`; run `npx prettier --write electron/src/**/*.js` before committing.

## Testing Guidelines
- House new pytest modules under `server/tests/test_<feature>.py` and mirror fixtures already used for ingestion (`faker_workspace`, `tmp_path`).
- Mark integration tests that require heavy assets with `@pytest.mark.skipif` or guard clauses (see `server/tests/test_pptx_extraction.py`) so they degrade gracefully offline.
- Prefer mocking `huggingface_hub` interactions as in `test_model_manager.py` to avoid real downloads; record any new sample files inside `data/README`.

## Commit & Pull Request Guidelines
- Keep commits short, imperative, and scoped (`server: fix reranker weights`), consistent with the existing history (`add ace editor mode`, `fix problems`).
- Every PR should supply: a one-paragraph behaviour summary, linked issues, screenshots or GIFs for UI changes, and the exact test command you ran (`python -m pytest -q`).
- Confirm both the backend (`uvicorn … --reload`) and renderer (`npm run dev`) start cleanly before requesting review and call out any manual model prefetch steps reviewers need.
