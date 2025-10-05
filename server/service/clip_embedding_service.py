import logging
from pathlib import Path
from threading import Lock
from typing import List, Optional, Sequence

import numpy as np
from PIL import Image

from service.model_manager import ensure_model_downloaded

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
            model_path = ensure_model_downloaded("clip_vit_b_32")
            logger.info("加载 CLIP 模型: %s", model_path)
            self._model = SentenceTransformer(str(model_path))
            logger.info("CLIP 模型加载完成")

    def encode_image_path(self, image_path: Path) -> List[float]:
        """Encode image located at the given path into a dense vector."""
        self._ensure_model_loaded()
        with Image.open(image_path) as img:
            image = img.convert("RGB")
            vector = self._model.encode(
                [image],
                convert_to_numpy=True,
                normalize_embeddings=True,
                batch_size=1,
                show_progress_bar=False
            )[0]  # type: ignore[union-attr]
        return self._to_list(vector)

    def encode_raw(self, image: Image.Image) -> List[float]:
        """Encode a PIL image instance."""
        self._ensure_model_loaded()
        image = image.convert("RGB")
        vector = self._model.encode(
            [image],
            convert_to_numpy=True,
            normalize_embeddings=True,
            batch_size=1,
            show_progress_bar=False
        )[0]  # type: ignore[union-attr]
        return self._to_list(vector)

    def encode_text(self, text: str) -> List[float]:
        """Encode a text string into the shared CLIP embedding space."""
        self._ensure_model_loaded()
        vector = self._model.encode(
            [text],
            convert_to_numpy=True,
            normalize_embeddings=True,
            show_progress_bar=False
        )[0]  # type: ignore[union-attr]
        return self._to_list(vector)

    def encode_texts(self, texts: Sequence[str]) -> List[List[float]]:
        """Batch encode multiple texts into CLIP embeddings."""
        cleaned = [str(text) for text in texts if str(text).strip()]
        if not cleaned:
            return []
        self._ensure_model_loaded()
        vectors = self._model.encode(
            cleaned,
            convert_to_numpy=True,
            normalize_embeddings=True,
            show_progress_bar=False
        )
        return [self._to_list(vec) for vec in vectors]

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
