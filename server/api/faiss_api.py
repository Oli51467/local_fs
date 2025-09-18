from fastapi import APIRouter, HTTPException
from typing import Dict, Any, List, Optional
import numpy as np
from service.faiss_service import FaissManager
from service.embedding_service import EmbeddingService
from model.faiss_request_model import SearchRequest
import logging

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/faiss", tags=["faiss"])

# 全局faiss管理器实例
faiss_manager = None
embedding_service = None

def init_faiss_api(faiss_mgr: FaissManager, embedding_svc: EmbeddingService = None):
    """初始化Faiss API"""
    global faiss_manager, embedding_service
    faiss_manager = faiss_mgr
    embedding_service = embedding_svc
    logger.info("Faiss API initialized")

@router.get("/test-connection")
async def test_faiss_connection() -> Dict[str, Any]:
    """测试Faiss数据库连接"""
    try:
        if faiss_manager is None:
            raise HTTPException(status_code=500, detail="Faiss manager not initialized")
        
        # 测试基本功能
        total_vectors = faiss_manager.get_total_vectors()
        
        return {
            "status": "success",
            "message": "Faiss数据库连接成功",
            "total_vectors": total_vectors,
            "dimension": faiss_manager.dimension,
            "index_type": "IndexFlatIP"
        }
    except Exception as e:
        logger.error(f"Faiss connection test failed: {str(e)}")
        raise HTTPException(status_code=500, detail=f"连接失败: {str(e)}")

@router.get("/statistics")
async def get_faiss_statistics() -> Dict[str, Any]:
    """获取Faiss数据库统计信息"""
    try:
        if faiss_manager is None:
            raise HTTPException(status_code=500, detail="Faiss manager not initialized")
        
        total_vectors = faiss_manager.get_total_vectors()
        
        # 统计元数据信息
        metadata_count = len(faiss_manager.metadata)
        
        # 按类型统计 - 优先使用file_type字段，如果没有则使用text/chunk_text判断
        type_stats = {}
        for meta in faiss_manager.metadata:
            # 优先使用file_type字段
            if 'file_type' in meta:
                doc_type = meta['file_type']
            else:
                # 如果没有file_type，根据内容判断或默认为unknown
                doc_type = 'unknown'
            type_stats[doc_type] = type_stats.get(doc_type, 0) + 1
        
        return {
            "total_vectors": total_vectors,
            "metadata_count": metadata_count,
            "dimension": faiss_manager.dimension,
            "index_path": str(faiss_manager.index_path),
            "metadata_path": str(faiss_manager.metadata_path),
            "type_statistics": type_stats
        }
    except Exception as e:
        logger.error(f"Failed to get Faiss statistics: {str(e)}")
        raise HTTPException(status_code=500, detail=f"获取统计信息失败: {str(e)}")

@router.get("/vectors")
async def get_all_vectors(limit: int = 100, offset: int = 0) -> Dict[str, Any]:
    """获取所有向量的元数据"""
    try:
        if faiss_manager is None:
            raise HTTPException(status_code=500, detail="Faiss manager not initialized")
        
        total_count = len(faiss_manager.metadata)
        
        # 分页获取元数据
        start_idx = offset
        end_idx = min(offset + limit, total_count)
        
        vectors_data = []
        for i in range(start_idx, end_idx):
            if i < len(faiss_manager.metadata):
                meta = faiss_manager.metadata[i].copy()
                vectors_data.append(meta)
        
        return {
            "vectors": vectors_data,
            "total_count": total_count,
            "limit": limit,
            "offset": offset,
            "has_more": end_idx < total_count
        }
    except Exception as e:
        logger.error(f"Failed to get vectors: {str(e)}")
        raise HTTPException(status_code=500, detail=f"获取向量数据失败: {str(e)}")

@router.post("/search")
async def search_vectors_post(request: SearchRequest) -> Dict[str, Any]:
    """搜索相似向量（POST方法）"""
    try:
        if faiss_manager is None:
            raise HTTPException(status_code=500, detail="Faiss manager not initialized")
        
        if embedding_service is None:
            raise HTTPException(status_code=500, detail="Embedding service not initialized")
        
        # 将查询文本转换为向量
        query_vector = embedding_service.encode_text(request.query)
        
        # 搜索相似向量
        results = faiss_manager.search_vectors([query_vector], k=request.top_k)
        
        return {
            "status": "success",
            "query": request.query,
            "results": results,
            "total_found": len(results[0]) if results else 0
        }
    except Exception as e:
        logger.error(f"Failed to search vectors: {str(e)}")
        raise HTTPException(status_code=500, detail=f"搜索失败: {str(e)}")

@router.get("/vectors/search")
async def search_vectors(query: str, k: int = 10) -> Dict[str, Any]:
    """搜索相似向量（需要提供查询文本）"""
    try:
        if faiss_manager is None:
            raise HTTPException(status_code=500, detail="Faiss manager not initialized")
        
        # 注意：这里需要文本向量化功能，暂时返回空结果
        # 在实际应用中，需要使用相同的embedding模型将查询文本转换为向量
        
        return {
            "query": query,
            "results": [],
            "message": "搜索功能需要配合文本向量化模型使用",
            "total_vectors": faiss_manager.get_total_vectors()
        }
    except Exception as e:
        logger.error(f"Failed to search vectors: {str(e)}")
        raise HTTPException(status_code=500, detail=f"搜索失败: {str(e)}")

@router.get("/vectors/by-type/{doc_type}")
async def get_vectors_by_type(doc_type: str, limit: int = 100, offset: int = 0) -> Dict[str, Any]:
    """根据文档类型获取向量"""
    try:
        if faiss_manager is None:
            raise HTTPException(status_code=500, detail="Faiss manager not initialized")
        
        # 筛选指定类型的向量 - 优先使用file_type字段
        filtered_vectors = []
        for meta in faiss_manager.metadata:
            # 优先使用file_type字段，如果没有则使用unknown
            if 'file_type' in meta:
                meta_type = meta['file_type']
            else:
                meta_type = 'unknown'
            
            if meta_type == doc_type:
                filtered_vectors.append(meta)
        
        total_count = len(filtered_vectors)
        
        # 分页
        start_idx = offset
        end_idx = min(offset + limit, total_count)
        page_vectors = filtered_vectors[start_idx:end_idx]
        
        return {
            "vectors": page_vectors,
            "doc_type": doc_type,
            "total_count": total_count,
            "limit": limit,
            "offset": offset,
            "has_more": end_idx < total_count
        }
    except Exception as e:
        logger.error(f"Failed to get vectors by type: {str(e)}")
        raise HTTPException(status_code=500, detail=f"获取指定类型向量失败: {str(e)}")

@router.delete("/vectors/{vector_id}")
async def delete_vector(vector_id: int) -> Dict[str, Any]:
    """删除指定向量（注意：Faiss不支持直接删除，这里只是示例）"""
    try:
        if faiss_manager is None:
            raise HTTPException(status_code=500, detail="Faiss manager not initialized")
        
        # Faiss索引不支持直接删除向量，需要重建索引
        # 这里只是返回提示信息
        return {
            "message": "Faiss索引不支持直接删除向量，需要重建索引",
            "vector_id": vector_id,
            "suggestion": "如需删除向量，请考虑重建整个索引"
        }
    except Exception as e:
        logger.error(f"Failed to delete vector: {str(e)}")
        raise HTTPException(status_code=500, detail=f"删除向量失败: {str(e)}")