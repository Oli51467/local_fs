"""Shared model download orchestration with progress tracking."""

from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Literal, Optional

from service.model_manager import (
    DownloadProgress,
    ModelManager,
    ModelSpec,
    get_model_manager,
)


logger = logging.getLogger(__name__)


ModelStatusLiteral = Literal["not_downloaded", "downloading", "downloaded", "failed"]


@dataclass
class _State:
    status: ModelStatusLiteral = "not_downloaded"
    progress: float = 0.0
    downloaded_bytes: int = 0
    total_bytes: Optional[int] = None
    message: Optional[str] = None
    error: Optional[str] = None
    endpoint: Optional[str] = None
    updated_at: float = field(default_factory=lambda: time.time())


@dataclass(frozen=True)
class ModelStatus:
    key: str
    name: str
    description: str
    tags: List[str]
    repo_id: str
    local_path: str
    status: ModelStatusLiteral
    progress: float
    downloaded_bytes: int
    total_bytes: Optional[int]
    message: Optional[str]
    error: Optional[str]
    endpoint: Optional[str]
    updated_at: float

    def to_dict(self) -> dict:
        return {
            "key": self.key,
            "name": self.name,
            "description": self.description,
            "tags": list(self.tags),
            "repo_id": self.repo_id,
            "local_path": self.local_path,
            "status": self.status,
            "progress": self.progress,
            "downloaded_bytes": self.downloaded_bytes,
            "total_bytes": self.total_bytes,
            "message": self.message,
            "error": self.error,
            "endpoint": self.endpoint,
            "updated_at": self.updated_at,
        }


class ModelDownloadService:
    """Coordinates model downloads and exposes progress snapshots."""

    def __init__(self, manager: Optional[ModelManager] = None) -> None:
        self._manager = manager or get_model_manager()
        self._states: Dict[str, _State] = {}
        self._threads: Dict[str, threading.Thread] = {}
        self._lock = threading.RLock()

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def ensure_download_and_get_path(self, key: str) -> Path:
        """Synchronously ensure a model is available locally."""

        spec = self._manager.get_spec(key)

        while True:
            with self._lock:
                state = self._ensure_state(spec)
                if self._manager.is_model_ready(key):
                    self._mark_downloaded_from_disk(spec, state)
                    return spec.local_path(self._manager.meta_root)

                thread = self._threads.get(key)
                if state.status == "downloading" and thread and thread.is_alive():
                    wait_thread = thread
                else:
                    self._mark_downloading(state, reset_progress=False)
                    wait_thread = None
                    break

            if wait_thread:
                wait_thread.join()
            else:
                break

        try:
            path = self._manager.get_model_path(
                key,
                download=True,
                progress_callback=self._handle_progress,
            )
        except Exception as exc:  # pragma: no cover - runtime failure
            logger.exception("Synchronous download for '%s' failed", key)
            self._handle_progress(
                DownloadProgress(
                    key=key,
                    status="failed",
                    progress=0.0,
                    downloaded_bytes=0,
                    total_bytes=None,
                    message=str(exc),
                    endpoint=None,
                )
            )
            raise

        return path

    def start_download(self, key: str) -> ModelStatus:
        """Kick off an asynchronous download and return the latest status."""

        spec = self._manager.get_spec(key)
        with self._lock:
            state = self._ensure_state(spec)
            if self._manager.is_model_ready(key):
                self._mark_downloaded_from_disk(spec, state)
                return self._build_status(spec, state)

            thread = self._threads.get(key)
            if thread and thread.is_alive():
                return self._build_status(spec, state)

            self._mark_downloading(state, reset_progress=True)
            worker = threading.Thread(
                target=self._run_download_thread,
                args=(spec.key,),
                name=f"model-download-{spec.key}",
                daemon=True,
            )
            self._threads[spec.key] = worker
            worker.start()
            return self._build_status(spec, state)

    def get_status(self, key: str) -> ModelStatus:
        """Return the current status for a single model."""

        spec = self._manager.get_spec(key)
        with self._lock:
            state = self._ensure_state(spec)
            if state.status != "downloading":
                self._sync_with_disk(spec, state)
            return self._build_status(spec, state)

    def list_statuses(self) -> List[ModelStatus]:
        """Return statuses for all registered models."""

        results: List[ModelStatus] = []
        with self._lock:
            for spec in self._manager.list_specs():
                state = self._ensure_state(spec)
                if state.status != "downloading":
                    self._sync_with_disk(spec, state)
                results.append(self._build_status(spec, state))
        return results

    def uninstall(self, key: str) -> ModelStatus:
        """Uninstall the given model by removing its local assets and return status."""
        spec = self._manager.get_spec(key)
        with self._lock:
            state = self._ensure_state(spec)
            try:
                self._manager.uninstall_model(key)
            except Exception as exc:
                state.status = "failed"
                state.message = f"卸载失败: {exc}"
                state.error = str(exc)
                state.updated_at = time.time()
                return self._build_status(spec, state)
            # Update state to reflect removal
            state.status = "not_downloaded"
            state.progress = 0.0
            state.downloaded_bytes = 0
            state.total_bytes = None
            state.message = "模型已卸载"
            state.error = None
            state.endpoint = None
            state.updated_at = time.time()
            return self._build_status(spec, state)

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _ensure_state(self, spec: ModelSpec) -> _State:
        state = self._states.get(spec.key)
        if state is None:
            is_ready = self._manager.is_model_ready(spec.key)
            state = _State(
                status="downloaded" if is_ready else "not_downloaded",
                progress=1.0 if is_ready else 0.0,
            )
            if is_ready:
                self._mark_downloaded_from_disk(spec, state)
            self._states[spec.key] = state
        return state

    def _run_download_thread(self, key: str) -> None:
        try:
            self._manager.get_model_path(
                key,
                download=True,
                progress_callback=self._handle_progress,
            )
        except Exception as exc:  # pragma: no cover - upstream failure already logged
            logger.exception("Asynchronous download for '%s' failed", key)
            self._handle_progress(
                DownloadProgress(
                    key=key,
                    status="failed",
                    progress=0.0,
                    downloaded_bytes=0,
                    total_bytes=None,
                    message=str(exc),
                    endpoint=None,
                )
            )
        finally:
            with self._lock:
                current = threading.current_thread()
                if self._threads.get(key) is current:
                    self._threads.pop(key, None)

    def _handle_progress(self, progress: DownloadProgress) -> None:
        with self._lock:
            spec = self._manager.get_spec(progress.key)
            state = self._ensure_state(spec)
            state.updated_at = time.time()
            state.endpoint = progress.endpoint
            if progress.total_bytes is not None:
                state.total_bytes = progress.total_bytes
            state.downloaded_bytes = max(progress.downloaded_bytes, 0)
            state.message = progress.message

            if progress.status == "downloading":
                state.status = "downloading"
                state.progress = max(state.progress, float(progress.progress))
                state.error = None
            elif progress.status == "completed":
                state.status = "downloaded"
                state.progress = 1.0
                state.error = None
                self._mark_downloaded_from_disk(spec, state)
            elif progress.status == "failed":
                state.status = "failed"
                state.progress = max(state.progress, float(progress.progress))
                state.error = progress.message or state.error

    def _mark_downloading(self, state: _State, *, reset_progress: bool) -> None:
        state.status = "downloading"
        if reset_progress:
            state.progress = 0.0
            state.downloaded_bytes = 0
            state.total_bytes = state.total_bytes or None
        state.error = None
        state.message = "准备下载模型..."
        state.updated_at = time.time()

    def _sync_with_disk(self, spec: ModelSpec, state: _State) -> None:
        if self._manager.is_model_ready(spec.key):
            self._mark_downloaded_from_disk(spec, state)
        elif state.status == "downloaded":
            # Model files removed externally
            state.status = "not_downloaded"
            state.progress = 0.0
            state.downloaded_bytes = 0
            state.message = None
            state.error = None
            state.total_bytes = None
            state.updated_at = time.time()

    def _mark_downloaded_from_disk(self, spec: ModelSpec, state: _State) -> None:
        local_path = spec.local_path(self._manager.meta_root)
        downloaded_bytes = self._measure_directory_size(local_path)
        state.status = "downloaded"
        state.progress = 1.0
        state.downloaded_bytes = downloaded_bytes
        if downloaded_bytes:
            state.total_bytes = max(state.total_bytes or 0, downloaded_bytes)
        elif state.total_bytes is None:
            state.total_bytes = downloaded_bytes
        state.error = None
        state.message = "模型已就绪"
        state.updated_at = time.time()

    def _build_status(self, spec: ModelSpec, state: _State) -> ModelStatus:
        local_path = spec.local_path(self._manager.meta_root)
        downloaded_bytes = state.downloaded_bytes
        total_bytes = state.total_bytes

        if state.status == "downloaded" and downloaded_bytes == 0:
            downloaded_bytes = self._measure_directory_size(local_path)
            total_bytes = total_bytes or downloaded_bytes

        progress = 1.0 if state.status == "downloaded" else max(0.0, min(state.progress, 1.0))

        return ModelStatus(
            key=spec.key,
            name=spec.display_name or spec.key,
            description=spec.description or "",
            tags=list(spec.tags),
            repo_id=spec.repo_id,
            local_path=str(local_path),
            status=state.status,
            progress=progress,
            downloaded_bytes=downloaded_bytes,
            total_bytes=total_bytes,
            message=state.message,
            error=state.error,
            endpoint=state.endpoint,
            updated_at=state.updated_at,
        )

    @staticmethod
    def _measure_directory_size(root: Path) -> int:
        if not root.exists():
            return 0
        total = 0
        try:
            for entry in root.rglob("*"):
                if not entry.is_file():
                    continue
                try:
                    total += entry.stat().st_size
                except OSError:
                    continue
        except OSError:
            return total
        return total


_DOWNLOAD_SERVICE: Optional[ModelDownloadService] = None


def get_model_download_service() -> ModelDownloadService:
    global _DOWNLOAD_SERVICE
    if _DOWNLOAD_SERVICE is None:
        _DOWNLOAD_SERVICE = ModelDownloadService()
    return _DOWNLOAD_SERVICE
