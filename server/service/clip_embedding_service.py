import logging
from pathlib import Path
from threading import Lock
from typing import List, Optional, Sequence, Tuple

import numpy as np
from PIL import Image

from service.model_manager import ensure_model_downloaded, get_model_path_if_available

try:
    from sentence_transformers import SentenceTransformer
except ImportError as exc:  # pragma: no cover - dependency should exist in runtime env
    SentenceTransformer = None  # type: ignore
    _import_error = exc
else:
    _import_error = None


logger = logging.getLogger(__name__)


PRIMARY_MODEL_KEYS = ("clip_vit_b_32_multilingual", "clip_vit_b_32")


class CLIPEmbeddingService:
    """Lazy-loading CLIP embedding service for image vectorization."""

    def __init__(self) -> None:
        self._model: Optional[SentenceTransformer] = None  # type: ignore[assignment]
        self._model_lock = Lock()
        self._model_key: Optional[str] = None
        # 专用于图像编码的 CLIP 模型（优先使用多语言 clip_vit_b_32_multilingual）
        self._image_model: Optional[SentenceTransformer] = None
        self._image_model_lock = Lock()

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
            model_key, model_path = self._resolve_model_path()
            logger.info("加载 CLIP 文本模型 (%s): %s", model_key, model_path)
            self._model = SentenceTransformer(str(model_path))
            self._model_key = model_key
            logger.info("CLIP 文本模型加载完成: %s", model_key)

    def _ensure_image_model_loaded(self) -> None:
        """确保用于图片编码的 CLIP 图像模型已加载（优先多语言，英文回退；均未安装则安装多语言）。"""
        if SentenceTransformer is None:
            details = str(_import_error) if _import_error else "missing dependency"
            raise RuntimeError(
                f"sentence-transformers is not available: {details}"
            )
        # 若主模型是多语言版本，直接复用作为图像编码模型
        if self._model is not None and self._model_key == "clip_vit_b_32_multilingual":
            with self._image_model_lock:
                if self._image_model is None:
                    self._image_model = self._model
            return
        # 否则按优先级加载：多语言已安装 -> 英文已安装 -> 下载多语言
        with self._image_model_lock:
            if self._image_model is not None:
                return
            image_model_path = get_model_path_if_available("clip_vit_b_32_multilingual")
            if image_model_path is None:
                image_model_path = get_model_path_if_available("clip_vit_b_32")
            if image_model_path is None:
                image_model_path = ensure_model_downloaded("clip_vit_b_32_multilingual")
            logger.info("加载用于图像编码的 CLIP 模型: %s", image_model_path)
            self._image_model = SentenceTransformer(str(image_model_path))
            logger.info("图像编码 CLIP 模型加载完成")

    def _resolve_model_path(self) -> Tuple[str, Path]:
        # 优先使用已安装的模型：先多语言，后英文版（文本编码）
        for key in PRIMARY_MODEL_KEYS:
            existing = get_model_path_if_available(key)
            if existing is not None:
                return key, existing

        # 若均未安装，默认只安装多语言模型（文本编码）
        try:
            path = ensure_model_downloaded("clip_vit_b_32_multilingual")
            return "clip_vit_b_32_multilingual", path
        except Exception as exc:  # pragma: no cover - runtime safeguard
            logger.warning("下载 CLIP 多语言文本模型失败: %s", exc)
            raise RuntimeError(
                "未能加载 CLIP 多语言文本模型，请在模型管理中下载 clip-ViT-B-32-multilingual。"
            ) from exc

    def encode_image_path(self, image_path: Path) -> List[float]:
        """Encode image located at the given path into a dense vector."""
        # 确保文本模型与图像模型均按需可用
        self._ensure_model_loaded()
        self._ensure_image_model_loaded()
        model = self._image_model if self._image_model is not None else self._model
        assert model is not None  # 运行保护
        with Image.open(image_path) as img:
            image = img.convert("RGB")
            vector = model.encode(
                [image],
                convert_to_numpy=True,
                normalize_embeddings=True,
                batch_size=1,
                show_progress_bar=False,
            )[0]  # type: ignore[index]
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
            show_progress_bar=False,
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
