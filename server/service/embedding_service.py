from FlagEmbedding import BGEM3FlagModel
from threading import Lock
from typing import List, Optional
import logging

from service.model_manager import ensure_model_downloaded

logger = logging.getLogger(__name__)

class EmbeddingService:
    def __init__(self) -> None:
        self._model: Optional[BGEM3FlagModel] = None
        self._model_lock = Lock()

    def _ensure_model_loaded(self) -> None:
        if self._model is not None:
            return
        with self._model_lock:
            if self._model is not None:
                return
            model_path = ensure_model_downloaded("bge_m3")
            logger.info("开始加载 BGE-M3 Embedding 模型: %s", model_path)
            self._model = BGEM3FlagModel(str(model_path), use_fp16=True)
            logger.info("BGE-M3 Embedding 模型加载完成")

    def encode_text(self, text: str) -> List[float]:
        """对单个文本进行向量化"""
        self._ensure_model_loaded()
        model = self._model
        assert model is not None  # for type checkers
        result = model.encode([text],
                              batch_size=1,
                              max_length=8192,
                              return_dense=True,
                              return_sparse=False,
                              return_colbert_vecs=False)
        return result['dense_vecs'][0].tolist()
    
    def encode_texts(self, texts: List[str]) -> List[List[float]]:
        """对多个文本进行向量化"""
        self._ensure_model_loaded()
        model = self._model
        assert model is not None
        result = model.encode(texts,
                              batch_size=12,
                              max_length=8192,
                              return_dense=True,
                              return_sparse=False,
                              return_colbert_vecs=False)
        return [vec.tolist() for vec in result['dense_vecs']]

# 全局实例
embedding_service = None

def get_embedding_service() -> EmbeddingService:
    """获取embedding服务实例"""
    global embedding_service
    if embedding_service is None:
        embedding_service = EmbeddingService()
    return embedding_service
