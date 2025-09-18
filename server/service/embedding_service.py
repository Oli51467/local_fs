from FlagEmbedding import BGEM3FlagModel
from typing import List
import logging
from config.server_config import ServerConfig

logger = logging.getLogger(__name__)

class EmbeddingService:
    def __init__(self):
        logger.info("开始加载 BGE-M3 Embedding 模型...")
        self.model = BGEM3FlagModel(ServerConfig.BGE_M3_MODEL_PATH, use_fp16=True)
        logger.info("BGE-M3 Embedding 模型加载完成")

    def encode_text(self, text: str) -> List[float]:
        """对单个文本进行向量化"""
        result = self.model.encode([text], 
                                 batch_size=1, 
                                 max_length=8192, 
                                 return_dense=True, 
                                 return_sparse=False, 
                                 return_colbert_vecs=False)
        return result['dense_vecs'][0].tolist()
    
    def encode_texts(self, texts: List[str]) -> List[List[float]]:
        """对多个文本进行向量化"""
        result = self.model.encode(texts, 
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