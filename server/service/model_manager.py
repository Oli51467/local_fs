"""Centralized model download and path management utilities."""

from __future__ import annotations

import fnmatch
import logging
import os
import time
from dataclasses import dataclass, field
from pathlib import Path
from threading import Event, Lock, Thread
from typing import Callable, Dict, Iterable, Literal, Optional, Sequence, Tuple, Union

from config.config import ServerConfig


logger = logging.getLogger(__name__)

RequiredFile = Union[str, Tuple[str, ...]]


@dataclass(frozen=True)
class ModelSpec:
    """Specification for a lazily downloaded model repository."""

    key: str
    repo_id: str
    local_subdir: Path
    required_files: Iterable[RequiredFile] = field(default_factory=tuple)
    revision: Optional[str] = None
    allow_patterns: Optional[Iterable[str]] = None
    ignore_patterns: Optional[Iterable[str]] = None
    endpoint: Optional[str] = None
    mirror_endpoints: Iterable[str] = field(default_factory=tuple)
    download_on_startup: bool = False
    display_name: Optional[str] = None
    description: Optional[str] = None
    tags: Sequence[str] = field(default_factory=tuple)
    repo_type: str = "model"

    def local_path(self, root: Path) -> Path:
        return root / self.local_subdir


@dataclass(frozen=True)
class DownloadProgress:
    """Structured progress information emitted during model downloads."""

    key: str
    status: Literal["pending", "downloading", "completed", "failed"]
    progress: float
    downloaded_bytes: int
    total_bytes: Optional[int]
    message: Optional[str] = None
    endpoint: Optional[str] = None


ProgressCallback = Callable[[DownloadProgress], None]


@dataclass(frozen=True)
class _RepoFileEntry:
    path: str
    size: Optional[int]


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

    def get_spec(self, key: str) -> ModelSpec:
        """Return the registered specification for a model key."""

        try:
            return self._registry[key]
        except KeyError as exc:  # pragma: no cover - defensive branch
            raise KeyError(f"Unknown model key: {key}") from exc

    def list_specs(self) -> Sequence[ModelSpec]:
        """Return an immutable snapshot of all registered model specs."""

        return tuple(self._registry.values())

    def is_model_ready(self, key: str) -> bool:
        """Check whether the model assets for the given key are present."""

        spec = self.get_spec(key)
        return self._is_ready(spec.local_path(self._meta_root), spec)

    def download_eager_models(self) -> None:
        """Download models marked for startup download."""

        for spec in self._registry.values():
            if not spec.download_on_startup:
                continue
            try:
                self.get_model_path(spec.key, download=True)
            except Exception:  # pragma: no cover - failures logged inside
                logger.exception("Failed to preload model '%s'", spec.key)

    def get_model_path(
        self,
        key: str,
        *,
        download: bool = True,
        progress_callback: Optional[ProgressCallback] = None,
    ) -> Path:
        """Return the local path for the given model, downloading if necessary."""

        spec = self.get_spec(key)
        local_path = spec.local_path(self._meta_root)
        local_path.mkdir(parents=True, exist_ok=True)

        if self._is_ready(local_path, spec):
            return local_path

        if not download:
            raise FileNotFoundError(f"Model '{key}' is not available at {local_path}")

        with self._lock_for(key):
            if self._is_ready(local_path, spec):
                return local_path
            self._download_model(local_path, spec, progress_callback=progress_callback)
        return local_path

    def uninstall_model(self, key: str) -> None:
        """Remove all local assets for the given model key.
        This deletes the corresponding subdirectory under the meta root.
        """
        spec = self.get_spec(key)
        local_path = spec.local_path(self._meta_root)
        with self._lock_for(key):
            try:
                import shutil
                if local_path.exists():
                    shutil.rmtree(local_path, ignore_errors=True)
            except Exception as exc:
                logger.exception("Uninstalling model '%s' failed at %s: %s", key, local_path, exc)
                raise

    def _is_ready(self, local_path: Path, spec: ModelSpec) -> bool:
        if not local_path.exists():
            return False
        try:
            next(local_path.iterdir())
        except StopIteration:
            return False
        except FileNotFoundError:
            return False

        for requirement in spec.required_files:
            if isinstance(requirement, tuple):
                if not any((local_path / candidate).exists() for candidate in requirement):
                    return False
                continue
            if not (local_path / requirement).exists():
                return False
        return True

    def _download_model(
        self,
        local_path: Path,
        spec: ModelSpec,
        *,
        progress_callback: Optional[ProgressCallback] = None,
    ) -> None:
        logger.info("Downloading model '%s' from %s", spec.key, spec.repo_id)
        try:
            from huggingface_hub import HfApi, snapshot_download
        except ImportError as exc:  # pragma: no cover - dependency declared in requirements
            raise RuntimeError("huggingface_hub is required to download models") from exc

        candidate_endpoints = self._candidate_endpoints(spec)

        allow_patterns = self._to_pattern_list(spec.allow_patterns)
        ignore_patterns = self._to_pattern_list(spec.ignore_patterns)

        last_error: Optional[Exception] = None
        for endpoint in candidate_endpoints:
            endpoint_label = endpoint or "https://huggingface.co"
            try:
                repo_info = self._fetch_repo_info(HfApi, spec, endpoint)
            except Exception as error:  # pragma: no cover - metadata fetch failures are logged
                last_error = error
                logger.warning(
                    "Fetching metadata for model '%s' via %s failed: %s",
                    spec.key,
                    endpoint_label,
                    error,
                )
                continue

            files = self._filter_repo_files(repo_info, allow_patterns, ignore_patterns)
            total_bytes = self._calculate_total_bytes(files)
            initial_downloaded = self._compute_downloaded_bytes(local_path, files)

            if progress_callback:
                progress_callback(
                    DownloadProgress(
                        key=spec.key,
                        status="downloading",
                        progress=self._calculate_progress(initial_downloaded, total_bytes),
                        downloaded_bytes=initial_downloaded,
                        total_bytes=total_bytes,
                        message=f"准备从 {endpoint_label} 下载",
                        endpoint=endpoint,
                    )
                )

            stop_event = Event()
            monitor_thread: Optional[Thread] = None

            if progress_callback:
                def _progress_worker() -> None:
                    last_progress = -1.0
                    last_bytes = -1
                    while not stop_event.wait(0.5):
                        downloaded = self._compute_downloaded_bytes(local_path, files)
                        progress = self._calculate_progress(downloaded, total_bytes)
                        if (
                            downloaded == last_bytes
                            and abs(progress - last_progress) < 0.001
                        ):
                            continue
                        progress_callback(
                            DownloadProgress(
                                key=spec.key,
                                status="downloading",
                                progress=progress,
                                downloaded_bytes=downloaded,
                                total_bytes=total_bytes,
                                message=f"正在从 {endpoint_label} 下载",
                                endpoint=endpoint,
                            )
                        )
                        last_bytes = downloaded
                        last_progress = progress

                monitor_thread = Thread(target=_progress_worker, daemon=True)
                monitor_thread.start()

            kwargs = {
                "repo_id": spec.repo_id,
                "repo_type": spec.repo_type,
                "local_dir": str(local_path),
                "local_dir_use_symlinks": False,
                "resume_download": True,
            }
            if spec.revision:
                kwargs["revision"] = spec.revision
            if allow_patterns is not None:
                kwargs["allow_patterns"] = allow_patterns
            if ignore_patterns is not None:
                kwargs["ignore_patterns"] = ignore_patterns

            success = False
            error: Optional[Exception] = None
            try:
                if endpoint:
                    snapshot_download(endpoint=endpoint, **kwargs)
                else:
                    snapshot_download(**kwargs)
                success = True
            except Exception as download_error:  # pragma: no cover - upstream errors are logged
                error = download_error
                logger.warning(
                    "Downloading model '%s' via %s failed: %s",
                    spec.key,
                    endpoint_label,
                    download_error,
                )
                downloaded = self._compute_downloaded_bytes(local_path, files)
                if progress_callback:
                    progress_callback(
                        DownloadProgress(
                            key=spec.key,
                            status="failed",
                            progress=self._calculate_progress(downloaded, total_bytes),
                            downloaded_bytes=downloaded,
                            total_bytes=total_bytes,
                            message=str(download_error),
                            endpoint=endpoint,
                        )
                    )
            finally:
                stop_event.set()
                if monitor_thread is not None:
                    monitor_thread.join(timeout=2.0)

            if success:
                downloaded = self._compute_downloaded_bytes(local_path, files)
                if total_bytes is not None:
                    downloaded = max(downloaded, total_bytes)
                if progress_callback:
                    progress_callback(
                        DownloadProgress(
                            key=spec.key,
                            status="completed",
                            progress=1.0,
                            downloaded_bytes=downloaded,
                            total_bytes=total_bytes,
                            message="模型下载完成",
                            endpoint=endpoint,
                        )
                    )
                logger.info("Model '%s' downloaded via %s", spec.key, endpoint_label)
                logger.info("Model '%s' is ready at %s", spec.key, local_path)
                return

            if error is None:  # pragma: no cover - defensive guard
                error = RuntimeError(
                    f"Unknown error downloading model '{spec.key}' via {endpoint_label}"
                )
            last_error = error

        assert last_error is not None  # for type checkers
        logger.exception("Failed to download model '%s'", spec.key)
        raise last_error

    def _lock_for(self, key: str) -> Lock:
        lock = self._locks.get(key)
        if lock is None:
            lock = Lock()
            self._locks[key] = lock
        return lock

    def _candidate_endpoints(self, spec: ModelSpec) -> list[Optional[str]]:
        def _trimmed(value: Optional[str]) -> Optional[str]:
            if value is None:
                return None
            stripped = value.rstrip("/")
            return stripped or None

        candidates: list[Optional[str]] = []

        def _add(value: Optional[str]) -> None:
            candidate = _trimmed(value)
            if candidate in candidates:
                return
            candidates.append(candidate)

        _add(spec.endpoint)
        for env_name in ("FS_HF_ENDPOINT", "HF_ENDPOINT", "HF_HUB_BASE_URL"):
            _add(os.environ.get(env_name))
        for mirror in spec.mirror_endpoints:
            _add(mirror)
        _add(None)
        return candidates

    @staticmethod
    def _to_pattern_list(patterns: Optional[Iterable[str]]) -> Optional[list[str]]:
        if patterns is None:
            return None
        if isinstance(patterns, str):
            normalized = [patterns]
        else:
            normalized = [str(item) for item in patterns if str(item)]
        return normalized or None

    @staticmethod
    def _fetch_repo_info(
        api_cls: Callable[..., object],
        spec: ModelSpec,
        endpoint: Optional[str],
    ) -> object:
        api = api_cls(endpoint=endpoint) if endpoint else api_cls()
        kwargs = {"repo_id": spec.repo_id, "repo_type": spec.repo_type}
        if spec.revision:
            kwargs["revision"] = spec.revision
        return api.repo_info(**kwargs)

    def _filter_repo_files(
        self,
        repo_info: object,
        allow_patterns: Optional[Sequence[str]],
        ignore_patterns: Optional[Sequence[str]],
    ) -> list[_RepoFileEntry]:
        siblings = getattr(repo_info, "siblings", []) or []
        entries: list[_RepoFileEntry] = []

        for sibling in siblings:
            path = getattr(sibling, "rfilename", None) or getattr(sibling, "path", None)
            if not path:
                continue
            if allow_patterns and not any(
                fnmatch.fnmatch(path, pattern) for pattern in allow_patterns
            ):
                continue
            if ignore_patterns and any(
                fnmatch.fnmatch(path, pattern) for pattern in ignore_patterns
            ):
                continue
            size = getattr(sibling, "size", None)
            entries.append(_RepoFileEntry(path=path, size=size))
        return entries

    @staticmethod
    def _calculate_total_bytes(files: Sequence[_RepoFileEntry]) -> Optional[int]:
        sizes = [entry.size for entry in files if entry.size is not None]
        if not sizes:
            return None
        return sum(int(size) for size in sizes)

    def _compute_downloaded_bytes(
        self,
        root: Path,
        files: Sequence[_RepoFileEntry],
    ) -> int:
        total = 0
        for entry in files:
            if entry.size is None:
                continue
            target = root / entry.path
            try:
                if target.exists():
                    total += target.stat().st_size
            except OSError:
                continue
        total += self._sum_incomplete_bytes(root)
        return total

    @staticmethod
    def _sum_incomplete_bytes(root: Path) -> int:
        if not root.exists():
            return 0
        total = 0
        try:
            for pending in root.rglob("*.incomplete"):
                try:
                    total += pending.stat().st_size
                except OSError:
                    continue
        except OSError:
            return total
        return total

    @staticmethod
    def _calculate_progress(
        downloaded: int,
        total: Optional[int],
    ) -> float:
        if not total or total <= 0:
            return 0.0
        ratio = downloaded / total
        if ratio >= 1:
            return 1.0
        if ratio <= 0:
            return 0.0
        return float(min(max(ratio, 0.0), 1.0))


def _build_registry() -> Dict[str, ModelSpec]:
    return {
        "bge_m3": ModelSpec(
            key="bge_m3",
            repo_id="BAAI/bge-m3",
            local_subdir=Path("embedding") / "bge-m3",
            required_files=(
                "config.json",
                ("pytorch_model.bin", "model.safetensors", "onnx/model.onnx"),
            ),
            mirror_endpoints=("https://hf-mirror.com",),
            download_on_startup=False,
            display_name="bge-m3",
            description="用于文本向量化与相似度检索的通用嵌入模型。",
            tags=("文本嵌入", "检索"),
        ),
        "bge_reranker_v2_m3": ModelSpec(
            key="bge_reranker_v2_m3",
            repo_id="BAAI/bge-reranker-v2-m3",
            local_subdir=Path("reranker") / "bge-reranker-v3-m3",
            required_files=(
                "config.json",
                ("pytorch_model.bin", "model.safetensors", "onnx/model.onnx"),
            ),
            mirror_endpoints=("https://hf-mirror.com",),
            download_on_startup=False,
            display_name="bge-reranker-v3-m3",
            description="用于提升检索结果相关性的重排序模型。",
            tags=("重排序", "检索"),
        ),
        "clip_vit_b_32": ModelSpec(
            key="clip_vit_b_32",
            repo_id="sentence-transformers/clip-ViT-B-32",
            local_subdir=Path("embedding") / "clip",
            required_files=(
                "modules.json",
                (
                    "0_CLIPModel/pytorch_model.bin",
                    "0_CLIPModel/model.safetensors",
                    "pytorch_model.bin",
                    "model.safetensors",
                    "onnx/model.onnx",
                ),
            ),
            mirror_endpoints=("https://hf-mirror.com",),
            download_on_startup=False,
            display_name="CLIP ViT-B 32",
            description="标准英文优化的 CLIP 模型，用于图文检索与比对。",
            tags=("图像嵌入", "多模态"),
        ),
        "clip_vit_b_32_multilingual": ModelSpec(
            key="clip_vit_b_32_multilingual",
            repo_id="sentence-transformers/clip-ViT-B-32-multilingual-v1",
            local_subdir=Path("embedding") / "clip-Vit-32B-multilingual",
            required_files=(
                "modules.json",
                (
                    "0_CLIPModel/pytorch_model.bin",
                    "0_CLIPModel/model.safetensors",
                    "pytorch_model.bin",
                    "model.safetensors",
                    "onnx/model.onnx",
                ),
            ),
            mirror_endpoints=("https://hf-mirror.com",),
            download_on_startup=False,
            display_name="CLIP ViT-B Multilingual",
            description="多语言支持的 CLIP 模型，提升中文等多语种的图文检索效果。",
            tags=("图像嵌入", "多模态"),
        ),
        "pdf_extract_kit": ModelSpec(
            key="pdf_extract_kit",
            repo_id="opendatalab/PDF-Extract-Kit-1.0",
            local_subdir=Path("pdf-extract-kit"),
            required_files=("README.md", "models"),
            download_on_startup=False,
            display_name="PDF Extract Kit",
            description="用于PDF解析的离线模型资源。",
            tags=("PDF解析", "OCR"),
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

    from service.model_download_service import get_model_download_service

    service = get_model_download_service()
    return service.ensure_download_and_get_path(key)


def get_model_path_if_available(key: str) -> Optional[Path]:
    """Return the model path if already available locally, otherwise ``None``."""

    try:
        return get_model_manager().get_model_path(key, download=False)
    except FileNotFoundError:
        return None
