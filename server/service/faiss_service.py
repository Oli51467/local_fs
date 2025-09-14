import sqlite3
import json
import faiss
import numpy as np
from pathlib import Path
from typing import List, Dict, Any, Optional
from config.config import DatabaseConfig
from .sqlite_service import SQLiteManager

class FaissManager:
    """Faiss向量数据库管理器"""
    
    def __init__(self, dimension: int = 384):
        self.dimension = dimension
        self.index_path = DatabaseConfig.VECTOR_INDEX_PATH
        self.metadata_path = DatabaseConfig.VECTOR_METADATA_PATH
        self.index = None
        self.metadata = []
        DatabaseConfig.ensure_directories()
    
    def init_index(self):
        """初始化Faiss索引"""
        if self.index_path.exists():
            # 加载现有索引
            self.index = faiss.read_index(str(self.index_path))
            if self.metadata_path.exists():
                with open(self.metadata_path, 'r', encoding='utf-8') as f:
                    self.metadata = json.load(f)
        else:
            # 创建新索引
            self.index = faiss.IndexFlatIP(self.dimension)  # 使用内积相似度
            self.metadata = []
            self.save_index()
    
    def add_vectors(self, vectors: np.ndarray, metadata_list: List[Dict]) -> List[int]:
        """添加向量到索引"""
        if vectors.shape[1] != self.dimension:
            raise ValueError(f"向量维度不匹配，期望 {self.dimension}，实际 {vectors.shape[1]}")
        
        # 标准化向量（用于余弦相似度）
        faiss.normalize_L2(vectors)
        
        # 获取当前索引大小作为起始ID
        start_id = self.index.ntotal
        
        # 添加向量
        self.index.add(vectors)
        
        # 添加元数据
        vector_ids = []
        for i, metadata in enumerate(metadata_list):
            vector_id = start_id + i
            self.metadata.append({
                'vector_id': vector_id,
                **metadata
            })
            vector_ids.append(vector_id)
        
        # 保存索引和元数据
        self.save_index()
        return vector_ids
    
    def search_vectors(self, query_vector: np.ndarray, k: int = 10) -> List[Dict]:
        """搜索相似向量"""
        if query_vector.shape[0] != self.dimension:
            raise ValueError(f"查询向量维度不匹配，期望 {self.dimension}，实际 {query_vector.shape[0]}")
        
        # 标准化查询向量
        query_vector = query_vector.reshape(1, -1)
        faiss.normalize_L2(query_vector)
        
        # 搜索
        scores, indices = self.index.search(query_vector, k)
        
        # 返回结果
        results = []
        for i, (score, idx) in enumerate(zip(scores[0], indices[0])):
            if idx != -1 and idx < len(self.metadata):
                result = self.metadata[idx].copy()
                result['similarity_score'] = float(score)
                results.append(result)
        
        return results
    
    def save_index(self):
        """保存索引和元数据"""
        faiss.write_index(self.index, str(self.index_path))
        with open(self.metadata_path, 'w', encoding='utf-8') as f:
            json.dump(self.metadata, f, ensure_ascii=False, indent=2)
    
    def get_total_vectors(self) -> int:
        """获取向量总数"""
        return self.index.ntotal if self.index else 0

def init_databases():
    """初始化所有数据库"""
    # 初始化SQLite数据库
    sqlite_manager = SQLiteManager()
    sqlite_manager.init_database()
    
    # 初始化Faiss向量数据库
    faiss_manager = FaissManager()
    faiss_manager.init_index()
    
    return sqlite_manager, faiss_manager