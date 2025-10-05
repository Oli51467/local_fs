"""Centralized model download and path management utilities."""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from pathlib import Path
from threading import Lock
from typing import Dict, Iterable, Optional

from config.config import ServerConfig


logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class ModelSpec:
    """Specification for a lazily downloaded model repository."""

    key: str
    repo_id: str
    local_subdir: Path
    required_files: Iterable[str] = field(default_factory=tuple)
    revision: Optional[str] = None
    allow_patterns: Optional[Iterable[str]] = None
    ignore_patterns: Optional[Iterable[str]] = None
    download_on_startup: bool = False

    def local_path(self, root: Path) -> Path:
        return root / self.local_subdir


class ModelManager:
    """Manage Hugging Face model assets stored under the project meta directory."""

    def __init__(self, registry: Dict[str, ModelSpec], meta_root: Optional[Path] = None) -> None:
        self._registry: Dict[str, ModelSpec] = dict(registry)
        self._meta_root = meta_root or (ServerConfig.PROJECT_ROOT / "meta")
        self._locks: Dict[str, Lock] = {}

    @property
    def meta_root(self) -> Path:
        return self._meta_root

    def ensure_base_directories(self) -> None:
        """Create the directory layout required by all registered models."""

        for spec in self._registry.values():
            path = spec.local_path(self._meta_root)
            path.mkdir(parents=True, exist_ok=True)

    def download_eager_models(self) -> None:
        """Download models marked for startup download."""

        for spec in self._registry.values():
            if not spec.download_on_startup:
                continue
            try:
                self.get_model_path(spec.key, download=True)
            except Exception:  # pragma: no cover - failures logged inside
                logger.exception("Failed to preload model '%s'", spec.key)

    def get_model_path(self, key: str, *, download: bool = True) -> Path:
        """Return the local path for the given model, downloading if necessary."""

        spec = self._registry.get(key)
        if spec is None:
            raise KeyError(f"Unknown model key: {key}")

        local_path = spec.local_path(self._meta_root)
        local_path.mkdir(parents=True, exist_ok=True)

        if self._is_ready(local_path, spec):
            return local_path

        if not download:
            raise FileNotFoundError(f"Model '{key}' is not available at {local_path}")

        with self._lock_for(key):
            if self._is_ready(local_path, spec):
                return local_path
            self._download_model(local_path, spec)
        return local_path

    def _is_ready(self, local_path: Path, spec: ModelSpec) -> bool:
        if not local_path.exists():
            return False
        try:
            next(local_path.iterdir())
        except StopIteration:
            return False
        except FileNotFoundError:
            return False

        for relative_name in spec.required_files:
            if not (local_path / relative_name).exists():
                return False
        return True

    def _download_model(self, local_path: Path, spec: ModelSpec) -> None:
        logger.info("Downloading model '%s' from %s", spec.key, spec.repo_id)
        try:
            from huggingface_hub import snapshot_download
        except ImportError as exc:  # pragma: no cover - dependency declared in requirements
            raise RuntimeError("huggingface_hub is required to download models") from exc

        kwargs = {
            "repo_id": spec.repo_id,
            "local_dir": str(local_path),
            "local_dir_use_symlinks": False,
            "resume_download": True,
        }
        if spec.revision:
            kwargs["revision"] = spec.revision
        if spec.allow_patterns is not None:
            kwargs["allow_patterns"] = list(spec.allow_patterns)
        if spec.ignore_patterns is not None:
            kwargs["ignore_patterns"] = list(spec.ignore_patterns)

        try:
            snapshot_download(**kwargs)
        except Exception as error:  # pragma: no cover - upstream errors are logged
            logger.exception("Failed to download model '%s': %s", spec.key, error)
            raise
        else:
            logger.info("Model '%s' is ready at %s", spec.key, local_path)

    def _lock_for(self, key: str) -> Lock:
        lock = self._locks.get(key)
        if lock is None:
            lock = Lock()
            self._locks[key] = lock
        return lock


def _build_registry() -> Dict[str, ModelSpec]:
    return {
        "bge_m3": ModelSpec(
            key="bge_m3",
            repo_id="BAAI/bge-m3",
            local_subdir=Path("embedding") / "bge-m3",
            required_files=("config.json", "pytorch_model.bin"),
            download_on_startup=True,
        ),
        "bge_reranker_v2_m3": ModelSpec(
            key="bge_reranker_v2_m3",
            repo_id="BAAI/bge-reranker-v2-m3",
            local_subdir=Path("reranker") / "bge-reranker-v3-m3",
            required_files=("config.json", "pytorch_model.bin"),
        ),
        "clip_vit_b_32": ModelSpec(
            key="clip_vit_b_32",
            repo_id="sentence-transformers/clip-ViT-B-32",
            local_subdir=Path("embedding") / "clip",
            required_files=("modules.json",),
        ),
        "pdf_extract_kit": ModelSpec(
            key="pdf_extract_kit",
            repo_id="opendatalab/PDF-Extract-Kit-1.0",
            local_subdir=Path("pdf-extract-kit"),
            required_files=("README.md", "models"),
        ),
    }


_MODEL_MANAGER: Optional[ModelManager] = None


def get_model_manager() -> ModelManager:
    global _MODEL_MANAGER
    if _MODEL_MANAGER is None:
        _MODEL_MANAGER = ModelManager(_build_registry())
    return _MODEL_MANAGER


def ensure_model_downloaded(key: str) -> Path:
    """Ensure the requested model is available locally and return its path."""

    return get_model_manager().get_model_path(key, download=True)


def get_model_path_if_available(key: str) -> Optional[Path]:
    """Return the model path if already available locally, otherwise ``None``."""

    try:
        return get_model_manager().get_model_path(key, download=False)
    except FileNotFoundError:
        return None
