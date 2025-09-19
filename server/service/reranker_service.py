from FlagEmbedding import FlagReranker
from pathlib import Path
import logging
from typing import List, Optional
import numpy as np

logger = logging.getLogger(__name__)

PROJECT_ROOT = Path(__file__).parent.parent.parent

class RerankerService:
    """
    Reranker服务类，用于对搜索结果进行重排序
    """
    
    def __init__(self, model_path: Optional[Path] = None):
        """
        初始化Reranker模型
        
        Args:
            model_path: 模型路径，如果为None则使用默认路径
        """
        if model_path is None:
            model_path = PROJECT_ROOT / "meta" / "reranker" / "bge-reranker-v2-m3"
        
        try:
            logger.info(f"正在加载Reranker模型: {model_path}")
            self.model = FlagReranker(model_path, use_fp16=True)
            logger.info("Reranker模型加载完成")
        except Exception as e:
            logger.error(f"Reranker模型加载失败: {e}")
            self.model = None
            raise e
    
    def compute_score(self, content: List[str]) -> List[float]:
        """
        计算文本对的相关性分数
        
        Args:
            content: 文本对列表，每个元素格式为 "query\tpassage" 或 [query, passage]
            
        Returns:
            相关性分数列表
        """
        if self.model is None:
            logger.error("Reranker模型未加载")
            return []
        
        try:
            scores = self.model.compute_score(content)
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
        if self.model is None:
            logger.error("Reranker模型未加载")
            return []
        
        try:
            scores = self.model.compute_score(content, normalize=True)
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
        if self.model is None:
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
        return self.model is not None

# 全局Reranker服务实例
reranker_service: Optional[RerankerService] = None

def init_reranker_service() -> bool:
    """
    初始化全局Reranker服务
    
    Returns:
        初始化是否成功
    """
    global reranker_service
    
    try:
        reranker_service = RerankerService()
        logger.info("Reranker服务初始化成功")
        return True
    except Exception as e:
        logger.error(f"Reranker服务初始化失败: {e}")
        reranker_service = None
        return False

def get_reranker_service() -> Optional[RerankerService]:
    """
    获取全局Reranker服务实例
    
    Returns:
        Reranker服务实例，如果未初始化则返回None
    """
    return reranker_service