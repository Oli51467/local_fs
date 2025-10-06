from FlagEmbedding import FlagReranker
from pathlib import Path
from threading import Lock
import logging
from typing import List, Optional
import numpy as np

from service.model_manager import ensure_model_downloaded

logger = logging.getLogger(__name__)

class RerankerService:
    """
    Reranker服务类，用于对搜索结果进行重排序
    """
    
    def __init__(self, model_path: Optional[Path] = None) -> None:
        """初始化Reranker模型。"""

        self._model: Optional[FlagReranker] = None
        self._model_lock = Lock()
        self._model_override = Path(model_path) if model_path is not None else None

    def _resolve_model_path(self) -> Path:
        if self._model_override is not None:
            return self._model_override
        return ensure_model_downloaded("bge_reranker_v2_m3")

    def _ensure_model_loaded(self) -> None:
        if self._model is not None:
            return
        with self._model_lock:
            if self._model is not None:
                return
            model_path = self._resolve_model_path()
            try:
                logger.info("正在加载Reranker模型: %s", model_path)
                self._model = FlagReranker(str(model_path), use_fp16=True)
                logger.info("Reranker模型加载完成")
            except Exception as exc:  # pragma: no cover - runtime failure
                logger.error("Reranker模型加载失败: %s", exc)
                self._model = None
                raise
    
    def compute_score(self, content: List[str]) -> List[float]:
        """
        计算文本对的相关性分数
        
        Args:
            content: 文本对列表，每个元素格式为 "query\tpassage" 或 [query, passage]
            
        Returns:
            相关性分数列表
        """
        try:
            self._ensure_model_loaded()
        except Exception:
            return []
        model = self._model
        if model is None:  # Safety guard; should not occur
            logger.error("Reranker模型未加载")
            return []

        try:
            scores = model.compute_score(content)
            # 确保返回的是列表，处理numpy数组或单个值的情况
            if isinstance(scores, (int, float, np.number)):
                # 单个值的情况
                return [float(scores)]
            elif isinstance(scores, np.ndarray):
                # numpy数组的情况
                return scores.astype(float).tolist()
            elif hasattr(scores, '__iter__') and not isinstance(scores, (str, bytes)):
                # 其他可迭代对象
                return [float(score) for score in scores]
            else:
                logger.warning(f"Unexpected scores type from compute_score: {type(scores)}, returning empty list")
                return []
        except Exception as e:
            logger.error(f"计算分数失败: {e}")
            return []
    
    def compute_score_normalize(self, content: List[str]) -> List[float]:
        """
        计算归一化的文本对相关性分数
        
        Args:
            content: 文本对列表，每个元素格式为 "query\tpassage" 或 [query, passage]
            
        Returns:
            归一化相关性分数列表 (0-1之间)
        """
        try:
            self._ensure_model_loaded()
        except Exception:
            return []
        model = self._model
        if model is None:
            logger.error("Reranker模型未加载")
            return []

        try:
            scores = model.compute_score(content, normalize=True)
            # 确保返回的是列表，处理numpy数组或单个值的情况
            if isinstance(scores, (int, float, np.number)):
                # 单个值的情况
                return [float(scores)]
            elif isinstance(scores, np.ndarray):
                # numpy数组的情况
                return scores.astype(float).tolist()
            elif hasattr(scores, '__iter__') and not isinstance(scores, (str, bytes)):
                # 其他可迭代对象
                return [float(score) for score in scores]
            else:
                logger.warning(f"Unexpected scores type from compute_score_normalize: {type(scores)}, returning empty list")
                return []
        except Exception as e:
            logger.error(f"计算归一化分数失败: {e}")
            return []
    
    def rerank_results(self, query: str, passages: List[str], normalize: bool = True) -> List[float]:
        """
        对搜索结果进行重排序
        
        Args:
            query: 查询文本
            passages: 候选文本列表
            normalize: 是否使用归一化分数
            
        Returns:
            相关性分数列表，与passages一一对应
        """
        try:
            self._ensure_model_loaded()
        except Exception:
            return [0.0] * len(passages)
        model = self._model
        if model is None:
            logger.error("Reranker模型未加载")
            return [0.0] * len(passages)
        
        # 构建文本对
        text_pairs = []
        for passage in passages:
            text_pairs.append([query, passage])
        
        # 计算分数
        if normalize:
            scores = self.compute_score_normalize(text_pairs)
        else:
            scores = self.compute_score(text_pairs)
        
        # 确保返回的是列表，而不是单个numpy值
        if isinstance(scores, (int, float)):
            # 如果返回的是单个值，转换为列表
            return [float(scores)] * len(passages)
        elif hasattr(scores, '__iter__') and not isinstance(scores, (str, bytes)):
            # 如果返回的是可迭代对象，转换为float列表
            return [float(score) for score in scores]
        else:
            # 其他情况，返回默认列表
            logger.warning(f"Unexpected scores type: {type(scores)}, using default values")
            return [0.0] * len(passages)
    
    def is_available(self) -> bool:
        """
        检查Reranker模型是否可用
        
        Returns:
            模型是否已加载成功
        """
        return self._model is not None

# 全局Reranker服务实例
reranker_service: Optional[RerankerService] = None

def init_reranker_service(model_path: Optional[Path] = None) -> RerankerService:
    """初始化全局Reranker服务并返回实例。"""

    global reranker_service
    reranker_service = RerankerService(model_path=model_path)
    logger.info("Reranker服务初始化成功")
    return reranker_service

def get_reranker_service() -> Optional[RerankerService]:
    """
    获取全局Reranker服务实例
    
    Returns:
        Reranker服务实例，如果未初始化则返回None
    """
    return reranker_service
