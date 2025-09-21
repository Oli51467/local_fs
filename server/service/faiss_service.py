import json
import faiss
import numpy as np
import logging
from typing import List, Dict
from config.config import DatabaseConfig
from .sqlite_service import SQLiteManager

logger = logging.getLogger(__name__)

class FaissManager:
    """Faiss向量数据库管理器"""
    
    def __init__(self, dimension: int = 1024):
        self.dimension = dimension
        self.index_path = DatabaseConfig.VECTOR_INDEX_PATH
        self.metadata_path = DatabaseConfig.VECTOR_METADATA_PATH
        self.index = None
        self.metadata = []
        DatabaseConfig.ensure_directories()
        self.init_index()  # 自动初始化索引
    
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
    
    def search_vectors(self, query_vectors: List[List[float]], k: int = 10) -> List[List[Dict]]:
        """搜索相似向量"""
        # 转换为numpy数组
        query_array = np.array(query_vectors, dtype=np.float32)
        
        if query_array.shape[1] != self.dimension:
            raise ValueError(f"查询向量维度不匹配，期望 {self.dimension}，实际 {query_array.shape[1]}")
        
        # 标准化查询向量
        faiss.normalize_L2(query_array)
        
        # 搜索
        scores, indices = self.index.search(query_array, k)
        
        # 返回结果
        all_results = []
        for query_idx in range(len(query_vectors)):
            results = []
            for i, (score, idx) in enumerate(zip(scores[query_idx], indices[query_idx])):
                if idx != -1 and idx < len(self.metadata):
                    result = self.metadata[idx].copy()
                    result['score'] = float(score)
                    result['rank'] = i + 1
                    results.append(result)
            all_results.append(results)
        
        return all_results
    
    def save_index(self):
        """保存索引和元数据"""
        faiss.write_index(self.index, str(self.index_path))
        with open(self.metadata_path, 'w', encoding='utf-8') as f:
            json.dump(self.metadata, f, ensure_ascii=False, indent=2)
    
    def add_vector(self, vector: List[float], metadata: Dict) -> int:
        """添加单个向量到索引"""
        vectors = np.array([vector], dtype=np.float32)
        vector_ids = self.add_vectors(vectors, [metadata])
        return vector_ids[0]
    
    def get_total_vectors(self) -> int:
        """获取向量总数"""
        return self.index.ntotal if self.index else 0
    
    def update_metadata_by_path(self, old_path: str, new_path: str) -> int:
        """更新指定路径的向量元数据"""
        updated_count = 0
        for metadata in self.metadata:
            if 'file_path' in metadata and metadata['file_path'] == old_path:
                metadata['file_path'] = new_path
                # 同时更新文件名
                if 'filename' in metadata:
                    metadata['filename'] = new_path.split('/')[-1]
                updated_count += 1
        
        if updated_count > 0:
            self.save_index()
            logger.info(f"Faiss元数据更新完成: {old_path} -> {new_path}, 更新了 {updated_count} 个向量")
        
        return updated_count
    
    def update_metadata_by_path_prefix(self, old_prefix: str, new_prefix: str) -> int:
        """更新所有以指定前缀开头的向量元数据（用于文件夹重命名）"""
        updated_count = 0
        for metadata in self.metadata:
            if 'file_path' in metadata and metadata['file_path'].startswith(old_prefix):
                old_file_path = metadata['file_path']
                new_file_path = old_file_path.replace(old_prefix, new_prefix, 1)
                metadata['file_path'] = new_file_path
                # 同时更新文件名
                if 'filename' in metadata:
                    metadata['filename'] = new_file_path.split('/')[-1]
                updated_count += 1
        
        if updated_count > 0:
            self.save_index()
            logger.info(f"Faiss元数据批量更新完成: {old_prefix} -> {new_prefix}, 更新了 {updated_count} 个向量")
        
        return updated_count
    
    def cleanup_all(self):
        """清理所有向量数据"""
        try:
            # 重置索引
            self.index = faiss.IndexFlatIP(self.dimension)
            self.metadata = []
            self.save_index()
            
            logger.info("Faiss向量索引清理完成")
            
        except Exception as e:
            logger.error(f"Faiss向量索引清理失败: {str(e)}")
            raise e

    def delete_vectors_by_ids(self, vector_ids: List[int]) -> int:
        """根据向量ID列表删除向量（Faiss不支持直接删除，需要重建索引）"""
        try:
            if not vector_ids:
                return 0
            
            # 由于Faiss不支持直接删除向量，我们需要重建索引
            # 获取当前所有向量
            current_count = self.index.ntotal
            if current_count == 0:
                return 0
            
            # 提取所有现有向量
            all_vectors = np.zeros((current_count, self.dimension), dtype=np.float32)
            self.index.reconstruct_n(0, current_count, all_vectors)
            
            # 创建新的索引和元数据，排除要删除的向量
            new_index = faiss.IndexFlatIP(self.dimension)
            new_metadata = []
            deleted_count = 0
            
            for i in range(current_count):
                if i not in vector_ids:
                    # 添加不在删除列表中的向量
                    vector = all_vectors[i:i+1]
                    if i < len(self.metadata):
                        new_metadata.append(self.metadata[i])
                    new_index.add(vector)
                else:
                    deleted_count += 1
            
            # 更新索引和元数据
            self.index = new_index
            self.metadata = new_metadata
            self.save_index()
            
            logger.info(f"Faiss向量删除完成: 删除了 {deleted_count} 个向量，剩余 {new_index.ntotal} 个向量")
            return deleted_count
            
        except Exception as e:
            logger.error(f"删除Faiss向量失败: {str(e)}")
            return 0

# 全局Faiss管理器实例
faiss_manager_instance = None

def init_faiss_manager():
    """初始化全局Faiss管理器"""
    global faiss_manager_instance
    faiss_manager_instance = FaissManager()
    return faiss_manager_instance

def get_faiss_manager():
    """获取全局Faiss管理器实例"""
    return faiss_manager_instance