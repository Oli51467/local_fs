from fastapi import APIRouter, HTTPException
from typing import Dict, Any, List, Optional
import numpy as np
from service.faiss_service import FaissManager
from service.embedding_service import EmbeddingService
from model.faiss_request_model import SearchRequest
import logging
from service.reranker_service import RerankerService, init_reranker_service, get_reranker_service
from service.bm25s_service import BM25SService, init_bm25s_service, get_bm25s_service
from config.config import ServerConfig

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/faiss", tags=["faiss"])

# 全局faiss管理器实例
faiss_manager = None
embedding_service = None
reranker_service = None
bm25s_service = None

def init_faiss_api(faiss_mgr: FaissManager, embedding_svc: EmbeddingService = None):
    """初始化Faiss API"""
    global faiss_manager, embedding_service, reranker_service, bm25s_service
    faiss_manager = faiss_mgr
    embedding_service = embedding_svc
    
    # 初始化Reranker服务
    try:
        reranker_service = get_reranker_service()
        if reranker_service is None:
            # 如果服务未初始化，尝试初始化
            if init_reranker_service():
                reranker_service = get_reranker_service()
                logger.info("Reranker服务初始化成功")
            else:
                logger.warning("Reranker服务初始化失败，将继续使用基础搜索")
        else:
            logger.info("Reranker服务已初始化")
    except Exception as e:
        logger.warning(f"Reranker服务初始化失败: {str(e)}，将继续使用基础搜索")
        reranker_service = None
    
    # 初始化BM25S服务
    try:
        bm25s_service = get_bm25s_service()
        if bm25s_service is None:
            # 如果服务未初始化，尝试初始化
            if init_bm25s_service():
                bm25s_service = get_bm25s_service()
                logger.info("BM25S服务初始化成功")
            else:
                logger.warning("BM25S服务初始化失败，将继续使用基础向量搜索")
        else:
            logger.info("BM25S服务已初始化")
        
        # 尝试构建BM25S索引
        if bm25s_service and faiss_manager and len(faiss_manager.metadata) > 0:
            logger.info(f"开始构建BM25S索引，文档数量: {len(faiss_manager.metadata)}")
            try:
                # 准备文档数据
                documents = []
                for i, meta in enumerate(faiss_manager.metadata):
                    # 获取文档内容，优先使用chunk_text，其次使用text
                    content = meta.get('chunk_text', '') or meta.get('text', '')
                    if content:
                        doc_id = str(i)  # 使用索引作为文档ID
                        documents.append({
                            'id': doc_id,
                            'content': content
                        })
                
                logger.info(f"准备构建BM25S索引的文档数量: {len(documents)}")
                
                if documents:
                    # 构建BM25S索引
                    success = bm25s_service.build_index(documents)
                    if success:
                        logger.info(f"BM25S索引构建完成，文档数量: {len(documents)}")
                        # 重新检查BM25S服务是否可用
                        logger.info(f"BM25S服务状态: available={bm25s_service.is_available()}")
                    else:
                        logger.warning("BM25S索引构建失败")
                else:
                    logger.warning("没有可用的文档内容用于构建BM25S索引")
            except Exception as e:
                logger.error(f"构建BM25S索引时出错: {e}")
        else:
            logger.info("BM25S索引构建条件不满足，跳过构建")
        
    except Exception as e:
        logger.warning(f"BM25S服务初始化失败: {str(e)}，将继续使用基础向量搜索")
        bm25s_service = None
    
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
    """搜索相似向量（POST方法）- 集成BM25S混合打分和Reranker二次排序"""
    try:
        if faiss_manager is None:
            raise HTTPException(status_code=500, detail="Faiss manager not initialized")
        
        if embedding_service is None:
            raise HTTPException(status_code=500, detail="Embedding service not initialized")
        
        # 将查询文本转换为向量
        query_vector = embedding_service.encode_text(request.query)
        
        # 第一步：使用Faiss进行向量召回（粗排）
        # 返回top10个结果用于BM25S混合打分
        recall_results = faiss_manager.search_vectors([query_vector], k=10)
        
        if not recall_results or not recall_results[0]:
            return {
                "status": "success",
                "query": request.query,
                "results": [],
                "total_found": 0,
                "bm25s_performed": False,
                "rerank_performed": False
            }
        
        # 第二步：BM25S混合打分
        mixed_results = []
        
        if bm25s_service is not None and bm25s_service.is_available() and recall_results[0]:
            # 获取召回文档的内容列表
            recall_contents = []
            for result in recall_results[0]:
                # 获取文档内容，优先使用chunk_text，其次使用text
                doc_content = result.get('chunk_text', '') or result.get('text', '')
                recall_contents.append(doc_content)
            
            if recall_contents:
                # 计算BM25S分数
                bm25s_scores = bm25s_service.score_documents(request.query, recall_contents)
                
                # 获取Faiss向量相似度分数（embedding_score）
                embedding_scores = [float(result.get('score', 0)) for result in recall_results[0]]
                
                # 混合打分：使用请求参数或配置权重
                bm25s_weight = request.bm25s_weight if request.bm25s_weight is not None else ServerConfig.BM25S_WEIGHT
                embedding_weight = request.embedding_weight if request.embedding_weight is not None else ServerConfig.EMBEDDING_WEIGHT
                
                # 确保权重之和为1
                total_weight = bm25s_weight + embedding_weight
                if total_weight > 0:
                    bm25s_weight = bm25s_weight / total_weight
                    embedding_weight = embedding_weight / total_weight
                
                for i, (result, bm25s_score, embedding_score) in enumerate(zip(recall_results[0], bm25s_scores, embedding_scores)):
                    mixed_score = bm25s_score * bm25s_weight + embedding_score * embedding_weight
                    mixed_item = result.copy()
                    mixed_item['bm25s_score'] = float(bm25s_score)
                    mixed_item['embedding_score'] = float(embedding_score)
                    mixed_item['mixed_score'] = float(mixed_score)
                    mixed_item['rank'] = i + 1
                    mixed_results.append(mixed_item)
                
                # 按混合分数降序排序
                mixed_results.sort(key=lambda x: x['mixed_score'], reverse=True)
                
                logger.info(f"BM25S混合打分完成，查询: '{request.query}', 结果数量: {len(mixed_results)}")
        
        # 如果BM25S不可用，使用原始向量分数
        if not mixed_results:
            mixed_results = recall_results[0][:]
            for i, result in enumerate(mixed_results):
                result['rank'] = i + 1
                result['embedding_score'] = float(result.get('score', 0))
                result['bm25s_score'] = 0.0
                result['mixed_score'] = float(result.get('score', 0))
        
        # 第三步：使用Reranker进行二次排序（精排）
        final_results = []
        
        if reranker_service is not None and reranker_service.is_available() and mixed_results:
            # 准备Reranker输入：[[query, doc1], [query, doc2], ...]
            reranker_input = []
            for result in mixed_results:
                # 获取文档内容，优先使用chunk_text，其次使用text
                doc_content = result.get('chunk_text', '') or result.get('text', '')
                if doc_content:
                    reranker_input.append([request.query, doc_content])
            
            if reranker_input:
                # 计算相关性分数
                rerank_scores = reranker_service.rerank_results(request.query, [item[1] for item in reranker_input])
                
                # 确保rerank_scores是列表
                if not isinstance(rerank_scores, list):
                    logger.warning(f"Reranker returned non-list type: {type(rerank_scores)}, converting to list")
                    if isinstance(rerank_scores, (int, float)):
                        rerank_scores = [float(rerank_scores)] * len(mixed_results)
                    else:
                        rerank_scores = [0.0] * len(mixed_results)
                
                # 组合结果和分数，按分数排序
                for i, (result, score) in enumerate(zip(mixed_results, rerank_scores)):
                    reranked_item = result.copy()
                    reranked_item['rerank_score'] = float(score)
                    final_results.append(reranked_item)
                
                # 按Reranker分数降序排序
                final_results.sort(key=lambda x: x['rerank_score'], reverse=True)
                
                # 只返回top3结果
                top3_results = final_results[:3]
                
                return {
                    "status": "success", 
                    "query": request.query,
                    "results": [top3_results],
                    "total_found": len(top3_results),
                    "bm25s_performed": True,
                    "rerank_performed": True,
                    "mixed_scores": [item['mixed_score'] for item in top3_results],
                    "bm25s_scores": [item['bm25s_score'] for item in top3_results],
                    "embedding_scores": [item['embedding_score'] for item in top3_results],
                    "rerank_scores": [item['rerank_score'] for item in top3_results]
                }
        
        # 如果没有Reranker，返回混合打分后的top3结果
        top3_results = mixed_results[:3]
        
        return {
            "status": "success",
            "query": request.query,
            "results": [top3_results],
            "total_found": len(top3_results),
            "bm25s_performed": bm25s_service is not None and bm25s_service.is_available(),
            "rerank_performed": False,
            "mixed_scores": [item['mixed_score'] for item in top3_results],
            "bm25s_scores": [item['bm25s_score'] for item in top3_results],
            "embedding_scores": [item['embedding_score'] for item in top3_results],
            "note": "使用BM25S混合打分，Reranker模型不可用"
        }
        
    except Exception as e:
        logger.error(f"Failed to search vectors with reranker: {str(e)}")
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