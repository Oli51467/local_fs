import bm25s
import jieba
import logging
from typing import List, Optional, Dict, Any
from pathlib import Path
import json
import numpy as np

logger = logging.getLogger(__name__)

class BM25SService:
    """
    BM25S服务类，用于文本检索和打分
    """
    
    def __init__(self, index_path: Optional[Path] = None):
        """
        初始化BM25S服务
        
        Args:
            index_path: 索引保存路径，如果为None则不保存/加载索引
        """
        self.index_path = index_path
        self.retriever = None
        self.corpus = []  # 存储文档内容
        self.doc_ids = []  # 存储文档ID映射
        self.is_loaded = False
        
    def build_index(self, documents: List[Dict[str, Any]]) -> bool:
        """
        构建BM25S索引
        
        Args:
            documents: 文档列表，每个文档包含 'id' 和 'content' 字段
            
        Returns:
            构建是否成功
        """
        try:
            logger.info(f"开始构建BM25S索引，文档数量: {len(documents)}")
            
            # 准备语料库和文档ID映射
            self.corpus = []
            self.doc_ids = []
            
            for doc in documents:
                doc_id = doc.get('id', str(len(self.corpus)))
                content = doc.get('content', '')
                if content:
                    self.corpus.append(content)
                    self.doc_ids.append(doc_id)
            
            if not self.corpus:
                logger.warning("没有有效的文档内容用于构建索引")
                return False
            
            # 中文分词处理
            logger.info("开始中文分词处理...")
            corpus_tokens = []
            for content in self.corpus:
                # 使用jieba进行中文分词
                tokens = jieba.lcut(content)
                corpus_tokens.append(tokens)
            
            # 创建BM25S检索器
            logger.info("创建BM25S检索器...")
            self.retriever = bm25s.BM25(corpus=self.corpus)
            self.retriever.index(corpus_tokens)
            
            self.is_loaded = True
            logger.info("BM25S索引构建完成")
            
            # 保存索引（如果指定了路径）
            if self.index_path:
                self.save_index(self.index_path)
            
            return True
            
        except Exception as e:
            logger.error(f"构建BM25S索引失败: {e}")
            return False
    
    def score_documents(self, query: str, documents: List[str]) -> List[float]:
        """
        对指定文档列表进行打分
        
        Args:
            query: 查询文本
            documents: 文档内容列表
            
        Returns:
            分数列表，与输入文档一一对应
        """
        if not documents:
            return []
        
        try:
            # 临时构建索引进行打分
            temp_corpus = documents.copy()
            temp_tokens = [jieba.lcut(doc) for doc in temp_corpus]
            
            temp_retriever = bm25s.BM25(corpus=temp_corpus)
            temp_retriever.index(temp_tokens)
            
            # 查询分词
            query_tokens = jieba.lcut(query)
            
            # 获取分数
            _, scores = temp_retriever.retrieve([query_tokens], k=len(documents))
            
            # 返回分数列表
            return [float(scores[0, i]) for i in range(len(documents))]
            
        except Exception as e:
            logger.error(f"BM25S文档打分失败: {e}")
            return [0.0] * len(documents)
    
    def is_available(self) -> bool:
        """
        检查服务是否可用
        
        Returns:
            服务是否已初始化
        """
        return self.is_loaded and self.retriever is not None
    
    def cleanup_all(self):
        """清理所有BM25S数据"""
        try:
            self.retriever = None
            self.corpus = []
            self.doc_ids = []
            self.is_loaded = False
            
            logger.info("BM25S索引清理完成")
            
        except Exception as e:
            logger.error(f"BM25S索引清理失败: {str(e)}")
            raise e

# 全局BM25S服务实例
bm25s_service: Optional[BM25SService] = None


def init_bm25s_service(index_path: Optional[Path] = None) -> BM25SService:
    """初始化全局BM25S服务并返回实例。"""

    global bm25s_service
    bm25s_service = BM25SService(index_path=index_path)
    logger.info("BM25S服务初始化成功")
    return bm25s_service


def get_bm25s_service() -> Optional[BM25SService]:
    """获取全局BM25S服务实例。"""

    return bm25s_service
