from typing import List
from FlagEmbedding import BGEM3FlagModel
from pathlib import Path

class BGEM3LangChainWrapper:
    """
    BGE-M3模型的LangChain兼容包装类
    实现了LangChain SemanticChunker所需的embed_documents方法
    """
    
    def __init__(self, model_path: str, use_fp16: bool = True):
        """
        初始化BGE-M3模型
        
        Args:
            model_path: 模型路径
            use_fp16: 是否使用半精度浮点数
        """
        self.model = BGEM3FlagModel(model_path, use_fp16=use_fp16)
    
    def embed_documents(self, texts: List[str]) -> List[List[float]]:
        """
        对文档列表进行向量化
        这是LangChain SemanticChunker所需的方法
        
        Args:
            texts: 文本列表
            
        Returns:
            向量列表，每个向量是一个浮点数列表
        """
        result = self.model.encode(
            texts, 
            batch_size=12, 
            max_length=8192, 
            return_dense=True, 
            return_sparse=False, 
            return_colbert_vecs=False
        )
        return [vec.tolist() for vec in result['dense_vecs']]
    
    def embed_query(self, text: str) -> List[float]:
        """
        对单个查询文本进行向量化
        
        Args:
            text: 查询文本
            
        Returns:
            向量，浮点数列表
        """
        result = self.model.encode(
            [text], 
            batch_size=1, 
            max_length=8192, 
            return_dense=True, 
            return_sparse=False, 
            return_colbert_vecs=False
        )
        return result['dense_vecs'][0].tolist()