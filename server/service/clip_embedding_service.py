import logging
from pathlib import Path
from threading import Lock
from typing import List, Optional, Sequence

import numpy as np
from PIL import Image

from config.config import ServerConfig

try:
    from sentence_transformers import SentenceTransformer
except ImportError as exc:  # pragma: no cover - dependency should exist in runtime env
    SentenceTransformer = None  # type: ignore
    _import_error = exc
else:
    _import_error = None


logger = logging.getLogger(__name__)


class CLIPEmbeddingService:
    """Lazy-loading CLIP embedding service for image vectorization."""

    def __init__(self) -> None:
        self._model: Optional[SentenceTransformer] = None  # type: ignore[assignment]
        self._model_lock = Lock()
        self._model_path = ServerConfig.PROJECT_ROOT / "meta" / "embedding" / "clip"

    def _ensure_model_loaded(self) -> None:
        if self._model is not None:
            return
        if SentenceTransformer is None:
            details = str(_import_error) if _import_error else "missing dependency"
            raise RuntimeError(
                f"sentence-transformers is not available: {details}"
            )
        with self._model_lock:
            if self._model is not None:
                return
            logger.info("加载 CLIP 模型: %s", self._model_path)
            self._model = SentenceTransformer(str(self._model_path))
            logger.info("CLIP 模型加载完成")

    def encode_image_path(self, image_path: Path) -> List[float]:
        """Encode image located at the given path into a dense vector."""
        self._ensure_model_loaded()
        with Image.open(image_path) as img:
            image = img.convert("RGB")
            vector = self._model.encode(image)  # type: ignore[union-attr]
        return self._to_list(vector)

    def encode_raw(self, image: Image.Image) -> List[float]:
        """Encode a PIL image instance."""
        self._ensure_model_loaded()
        image = image.convert("RGB")
        vector = self._model.encode(image)  # type: ignore[union-attr]
        return self._to_list(vector)

    @staticmethod
    def _to_list(vector: Sequence[float]) -> List[float]:
        if isinstance(vector, np.ndarray):
            return vector.astype(np.float32).tolist()
        return [float(x) for x in vector]


_clip_service: Optional[CLIPEmbeddingService] = None


def get_clip_embedding_service() -> CLIPEmbeddingService:
    global _clip_service
    if _clip_service is None:
        _clip_service = CLIPEmbeddingService()
    return _clip_service
