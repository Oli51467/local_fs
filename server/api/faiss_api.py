from fastapi import APIRouter, HTTPException
from typing import Dict, Any, List, Optional
from pathlib import Path
import numpy as np
import statistics
from service.faiss_service import FaissManager
from service.image_faiss_service import ImageFaissManager, get_image_faiss_manager
from service.embedding_service import EmbeddingService
from service.clip_embedding_service import get_clip_embedding_service
from model.faiss_request_model import SearchRequest
import logging
from service.reranker_service import RerankerService, init_reranker_service, get_reranker_service
from service.bm25s_service import BM25SService, init_bm25s_service, get_bm25s_service
from config.config import ServerConfig

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/faiss", tags=["faiss"])

# 全局faiss管理器实例
faiss_manager = None
image_faiss_manager = None
embedding_service = None
reranker_service = None
bm25s_service = None


def clamp_unit(value: Optional[float]) -> float:
    try:
        val = float(value)
    except (TypeError, ValueError):
        return 0.0
    if np.isnan(val):
        return 0.0
    if val < 0.0:
        return 0.0
    if val > 1.0:
        return 1.0
    return val


def normalize_embedding_score(value: Optional[float]) -> Optional[float]:
    if value is None:
        return None
    try:
        val = float(value)
    except (TypeError, ValueError):
        return None
    if np.isnan(val):
        return None
    normalized = (val + 1.0) / 2.0
    return clamp_unit(normalized)


def normalize_rerank_score(value: Optional[float]) -> Optional[float]:
    if value is None:
        return None
    try:
        val = float(value)
    except (TypeError, ValueError):
        return None
    if np.isnan(val):
        return None
    return clamp_unit(val)


def compute_final_confidence(result: Dict[str, Any]) -> float:
    if result is None:
        return 0.0

    sources = result.get('sources') or []
    primary_source = result.get('source')
    if 'exact' in sources or primary_source == 'exact':
        return 1.0

    rerank_score = normalize_rerank_score(result.get('rerank_score'))
    if rerank_score is not None:
        return rerank_score

    if result.get('quality_score') is not None:
        return clamp_unit(result['quality_score'])

    if result.get('mixed_score') is not None:
        return clamp_unit(result['mixed_score'])

    emb_norm = normalize_embedding_score(result.get('embedding_score'))
    if emb_norm is not None:
        return emb_norm

    return 0.0


def filter_semantic_candidates(
    candidates: List[Dict[str, Any]],
    bm25_weight: float,
    embedding_weight: float,
) -> List[Dict[str, Any]]:
    if not candidates:
        return candidates

    embedding_norms = [normalize_embedding_score(item.get('embedding_score')) for item in candidates if item.get('embedding_score') is not None]
    bm25_norms = [clamp_unit(item.get('bm25s_score')) for item in candidates if item.get('bm25s_score') is not None]

    embedding_median = statistics.median(embedding_norms) if embedding_norms else None
    bm25_median = statistics.median(bm25_norms) if bm25_norms else None

    filtered: List[Dict[str, Any]] = []

    for item in candidates:
        emb_norm = normalize_embedding_score(item.get('embedding_score'))
        bm_norm = clamp_unit(item.get('bm25s_score')) if item.get('bm25s_score') is not None else None

        emb_val = emb_norm if emb_norm is not None else 0.0
        bm_val = bm_norm if bm_norm is not None else 0.0

        if embedding_median is not None and bm25_median is not None:
            if emb_val < embedding_median and (bm_norm is None or bm_val < bm25_median):
                continue

            if emb_val >= embedding_median and bm_norm is not None and bm_val >= bm25_median:
                weighted = bm25_weight * bm_val + embedding_weight * emb_val
                item['quality_score'] = weighted
                if weighted < 0.5:
                    continue
        elif embedding_median is not None:
            if emb_val < embedding_median:
                continue
        elif bm25_median is not None and bm_norm is not None:
            if bm_val < bm25_median:
                continue

        filtered.append(item)

    return filtered


def search_image_vectors(
    query_text: str,
    top_k: int,
    threshold: float = 0.35,
    recall_multiplier: int = 8,
) -> List[Dict[str, Any]]:
    if not query_text:
        return []
    if image_faiss_manager is None:
        return []

    try:
        clip_service = get_clip_embedding_service()
    except Exception as exc:  # pylint: disable=broad-except
        logger.warning("CLIP 服务不可用，跳过图片检索: %s", exc)
        return []

    base_query = query_text.strip()
    if not base_query:
        return []

    prompt_candidates = [base_query]
    base_lower = base_query.lower()
    prompt_templates = [
        "a photo of {query}",
        "an image of {query}",
        "a picture of {query}",
        "a close-up photo of {query}",
        "{query}"
    ]
    for template in prompt_templates:
        prompt_candidates.append(template.format(query=base_lower))

    unique_prompts: List[str] = []
    seen_prompts = set()
    for prompt in prompt_candidates:
        normalized = prompt.strip()
        if not normalized or normalized in seen_prompts:
            continue
        unique_prompts.append(normalized)
        seen_prompts.add(normalized)

    try:
        query_embeddings = clip_service.encode_texts(unique_prompts)
    except Exception as exc:  # pylint: disable=broad-except
        logger.error("生成CLIP文本向量失败: %s", exc)
        return []

    if not query_embeddings:
        return []

    query_embeddings_np = [np.asarray(vec, dtype=np.float32) for vec in query_embeddings]

    aggregate_vector = np.mean(query_embeddings_np, axis=0)
    aggregate_norm = np.linalg.norm(aggregate_vector)
    if aggregate_norm <= 0:
        aggregate_vector = query_embeddings_np[0]
    else:
        aggregate_vector = aggregate_vector / aggregate_norm

    search_vector = aggregate_vector.astype(np.float32, copy=False)[np.newaxis, :]

    recall_k = max(top_k * recall_multiplier, 120)
    try:
        search_results = image_faiss_manager.search_vectors(search_vector, k=recall_k)
    except Exception as exc:  # pylint: disable=broad-except
        logger.error("图片向量检索失败: %s", exc)
        return []

    matches: List[Dict[str, Any]] = []
    project_root = ServerConfig.PROJECT_ROOT.resolve()

    candidates = search_results[0] if search_results else []
    for idx, candidate in enumerate(candidates):
        vector_index = candidate.get('vector_id')
        # vector_id is stored separately; fallback to faiss index position
        faiss_index = candidate.get('vector_id') if candidate.get('vector_id') is not None else idx

        try:
            reconstructed = image_faiss_manager.index.reconstruct(int(faiss_index))  # type: ignore[arg-type]
        except Exception as exc:  # pylint: disable=broad-except
            logger.debug("无法重构图片向量(%s): %s", faiss_index, exc)
            continue

        candidate_vector = np.array(reconstructed, dtype=np.float32, copy=False)
        candidate_norm = np.linalg.norm(candidate_vector)
        if candidate_norm > 0:
            candidate_vector = candidate_vector / candidate_norm

        cosine_scores = [float(np.dot(candidate_vector, query_vec)) for query_vec in query_embeddings_np]
        if not cosine_scores:
            continue

        best_cosine = max(cosine_scores)
        if best_cosine < threshold:
            continue

        average_cosine = sum(cosine_scores) / len(cosine_scores)
        combined_cosine = 0.65 * best_cosine + 0.35 * average_cosine
        normalized_confidence = clamp_unit((combined_cosine + 1.0) / 2.0)

        record = dict(candidate)
        storage_path = record.get('storage_path') or ''
        try:
            if storage_path:
                storage_path_obj = Path(storage_path)
                if storage_path_obj.is_absolute():
                    absolute_storage = storage_path_obj.resolve()
                else:
                    absolute_storage = (project_root / storage_path_obj).resolve()
                record['absolute_storage_path'] = str(absolute_storage)
        except Exception as exc:  # pylint: disable=broad-except
            logger.debug("解析图片存储路径失败 (%s): %s", storage_path, exc)

        file_path = record.get('file_path') or ''
        try:
            if file_path:
                file_path_obj = Path(file_path)
                if file_path_obj.is_absolute():
                    absolute_doc = file_path_obj.resolve()
                else:
                    absolute_doc = (project_root / file_path_obj).resolve()
                record['absolute_path'] = str(absolute_doc)
            elif 'absolute_storage_path' in record:
                record['absolute_path'] = record['absolute_storage_path']
        except Exception as exc:  # pylint: disable=broad-except
            logger.debug("解析文档路径失败 (%s): %s", file_path, exc)

        record['result_type'] = 'image'
        record['source'] = 'image'
        record['sources'] = ['image']
        record['vector_index'] = int(faiss_index)
        record['cosine_similarity'] = best_cosine
        record['avg_cosine'] = average_cosine
        record['combined_cosine'] = combined_cosine
        record['confidence'] = normalized_confidence
        record['image_score'] = combined_cosine
        record['final_score'] = normalized_confidence
        record['rank'] = len(matches) + 1
        record['metrics'] = {
            'image': {
                'rank': record['rank'],
                'confidence': normalized_confidence,
                'best_cosine': best_cosine,
                'avg_cosine': average_cosine,
                'combined_cosine': combined_cosine
            }
        }
        record.setdefault('filename', record.get('image_name'))
        record.setdefault('display_name', record.get('image_name'))
        matches.append(record)
        if len(matches) >= top_k:
            break

    return matches

def init_faiss_api(
    faiss_mgr: FaissManager,
    embedding_svc: EmbeddingService = None,
    image_faiss_mgr: ImageFaissManager = None
):
    """初始化Faiss API"""
    global faiss_manager, image_faiss_manager, embedding_service, reranker_service, bm25s_service
    faiss_manager = faiss_mgr
    image_faiss_manager = image_faiss_mgr or get_image_faiss_manager()
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
    """综合字符匹配与语义检索的搜索接口"""
    try:
        if faiss_manager is None:
            raise HTTPException(status_code=500, detail="Faiss manager not initialized")

        if embedding_service is None:
            raise HTTPException(status_code=500, detail="Embedding service not initialized")

        top_k = max(request.top_k or 10, 1)
        query_text = (request.query or '').strip()
        if not query_text:
            raise HTTPException(status_code=400, detail="查询内容不能为空")

        query_lower = query_text.lower()

        def build_result(meta: Dict[str, Any], source: str, overrides: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
            data = dict(meta) if isinstance(meta, dict) else {}
            file_path = data.get('file_path') or data.get('path') or ''
            if file_path and not data.get('filename'):
                data['filename'] = Path(file_path).name
            if file_path:
                path_obj = Path(file_path)
                if not path_obj.is_absolute():
                    path_obj = (ServerConfig.PROJECT_ROOT / path_obj).resolve()
                data['absolute_path'] = str(path_obj)
            data['source'] = source
            if overrides:
                data.update(overrides)
            return data

        def build_chunk_key(meta: Dict[str, Any]) -> tuple:
            vector_id = meta.get('vector_id')
            if vector_id is not None:
                return ('vector', vector_id)
            file_path = meta.get('file_path') or meta.get('path') or ''
            chunk_index = meta.get('chunk_index')
            if file_path and chunk_index is not None:
                return ('chunk_index', file_path, chunk_index)
            chunk_id = meta.get('chunk_id') or meta.get('id')
            if file_path and chunk_id is not None:
                return ('chunk_id', file_path, chunk_id)
            return ('chunk_text', file_path, (meta.get('chunk_text') or meta.get('text') or '')[:64])

        exact_results: List[Dict[str, Any]] = []
        seen_exact = set()

        for meta in faiss_manager.metadata or []:
            chunk_text = (meta.get('chunk_text') or meta.get('text') or '')
            filename = meta.get('filename') or ''
            file_path = meta.get('file_path') or meta.get('path') or ''

            match_position = None
            for candidate in (chunk_text, filename, file_path):
                if not candidate:
                    continue
                candidate_lower = str(candidate).lower()
                pos = candidate_lower.find(query_lower)
                if pos != -1:
                    if match_position is None or pos < match_position:
                        match_position = pos
            if match_position is None:
                continue

            key = build_chunk_key(meta)
            if key in seen_exact:
                continue
            seen_exact.add(key)

            rank = len(exact_results) + 1
            exact_results.append(
                build_result(
                    meta,
                    'exact',
                    {
                        'rank': rank,
                        'match_position': match_position,
                        'match_score': 1.0,
                    }
                )
            )

        logger.info("字符匹配完成，查询: '%s'，匹配数量: %d", query_text, len(exact_results))

        perfect_exact_matches = [
            item for item in exact_results
            if (item.get('chunk_text') or item.get('text') or '').strip().lower() == query_text.lower()
        ]

        semantic_candidates: List[Dict[str, Any]] = []
        bm25s_used = False
        rerank_used = False

        if perfect_exact_matches:
            exact_results = perfect_exact_matches[:top_k]
        else:
            query_vector = embedding_service.encode_text(query_text)
            recall_k = max(top_k * 8, 80)
            recall_results = faiss_manager.search_vectors([query_vector], k=recall_k)
            raw_candidates = recall_results[0] if recall_results else []

            if raw_candidates:
                for candidate in raw_candidates:
                    semantic_candidates.append(
                        build_result(
                            candidate,
                            'semantic',
                            {
                                'embedding_score': float(candidate.get('score', 0.0))
                            }
                        )
                    )

                bm25s_scores: List[float] = [0.0] * len(semantic_candidates)
                if bm25s_service is not None and bm25s_service.is_available():
                    corpus_contents = [item.get('chunk_text') or item.get('text') or '' for item in semantic_candidates]
                    if any(corpus_contents):
                        bm25s_scores = bm25s_service.score_documents(query_text, corpus_contents)
                        bm25s_used = True

                bm25s_weight = request.bm25s_weight if request.bm25s_weight is not None else ServerConfig.BM25S_WEIGHT
                embedding_weight = request.embedding_weight if request.embedding_weight is not None else ServerConfig.EMBEDDING_WEIGHT
                total_weight = bm25s_weight + embedding_weight
                if total_weight <= 0:
                    bm25s_weight = embedding_weight = 0.5
                else:
                    bm25s_weight /= total_weight
                    embedding_weight /= total_weight

                for idx, item in enumerate(semantic_candidates):
                    embedding_score = float(item.get('embedding_score', 0.0))
                    bm25_raw = float(bm25s_scores[idx]) if idx < len(bm25s_scores) else 0.0
                    bm25_norm = float(bm25_raw / (bm25_raw + 1.0)) if bm25_raw > 0 else 0.0
                    item['bm25s_raw_score'] = bm25_raw if bm25s_used else None
                    item['bm25s_score'] = bm25_norm if bm25s_used else None
                    item['mixed_score'] = (
                        bm25_norm * bm25s_weight + embedding_score * embedding_weight
                        if bm25s_used
                        else embedding_score
                    )

                semantic_candidates = filter_semantic_candidates(semantic_candidates, bm25s_weight, embedding_weight)

                if reranker_service is not None and reranker_service.is_available() and semantic_candidates:
                    rerank_texts: List[str] = []
                    rerank_indices: List[int] = []
                    for idx, item in enumerate(semantic_candidates):
                        content = item.get('chunk_text') or item.get('text') or ''
                        if content:
                            rerank_texts.append(content)
                            rerank_indices.append(idx)
                    if rerank_texts:
                        rerank_scores = reranker_service.rerank_results(query_text, rerank_texts)
                        if not isinstance(rerank_scores, list):
                            if isinstance(rerank_scores, (int, float)):
                                rerank_scores = [float(rerank_scores)] * len(rerank_texts)
                            else:
                                rerank_scores = [0.0] * len(rerank_texts)
                        rerank_used = True
                        for local_idx, score in enumerate(rerank_scores):
                            global_idx = rerank_indices[local_idx]
                            semantic_candidates[global_idx]['rerank_score'] = float(score)
                        semantic_candidates.sort(
                            key=lambda x: (
                                x.get('rerank_score', float('-inf')),
                                x.get('mixed_score', float('-inf'))
                            ),
                            reverse=True
                        )
                    else:
                        semantic_candidates.sort(key=lambda x: x.get('mixed_score', 0.0), reverse=True)
                else:
                    semantic_candidates.sort(key=lambda x: x.get('mixed_score', 0.0), reverse=True)

        semantic_results: List[Dict[str, Any]] = []
        if semantic_candidates:
            ranked_candidates = semantic_candidates[:top_k]
            for idx, item in enumerate(ranked_candidates, start=1):
                semantic_entry = build_result(
                    item,
                    'semantic',
                    {
                        'rank': idx,
                        'embedding_score': float(item.get('embedding_score', 0.0)),
                        'bm25s_score': item.get('bm25s_score'),
                        'bm25s_raw_score': item.get('bm25s_raw_score'),
                        'mixed_score': float(item.get('mixed_score', 0.0)),
                        'rerank_score': float(item.get('rerank_score', 0.0)) if 'rerank_score' in item else None,
                        'quality_score': item.get('quality_score')
                    }
                )
                confidence = compute_final_confidence(semantic_entry)
                semantic_entry['final_score'] = confidence
                if confidence < 0.3:
                    continue
                semantic_results.append(semantic_entry)

        combined_map: Dict[tuple, Dict[str, Any]] = {}

        def metrics_from_result(result: Dict[str, Any]) -> Dict[str, Any]:
            return {
                'rank': result.get('rank'),
                'match_position': result.get('match_position'),
                'match_score': result.get('match_score'),
                'embedding_score': result.get('embedding_score'),
                'bm25s_score': result.get('bm25s_score'),
                'bm25s_raw_score': result.get('bm25s_raw_score'),
                'mixed_score': result.get('mixed_score'),
                'rerank_score': result.get('rerank_score')
            }

        def merge_result(result: Dict[str, Any]) -> None:
            key = build_chunk_key(result)
            stored = combined_map.get(key)
            result_copy = dict(result)
            metrics = metrics_from_result(result_copy)
            if stored:
                if result_copy['source'] not in stored['sources']:
                    stored['sources'].append(result_copy['source'])
                stored['metrics'][result_copy['source']] = metrics
                stored['source'] = '+'.join(sorted(stored['sources']))
                for field in (
                    'rank',
                    'match_position',
                    'match_score',
                    'embedding_score',
                    'bm25s_score',
                    'bm25s_raw_score',
                    'mixed_score',
                    'rerank_score',
                    'quality_score'
                ):
                    value = result_copy.get(field)
                    if value is not None and stored.get(field) is None:
                        stored[field] = value
            else:
                result_copy['sources'] = [result_copy['source']]
                result_copy['metrics'] = {result_copy['source']: metrics}
                combined_map[key] = result_copy

        for item in exact_results:
            item['final_score'] = compute_final_confidence(item)
            merge_result(item)
        for item in semantic_results:
            merge_result(item)

        combined_results = list(combined_map.values())
        combined_results.sort(
            key=lambda x: (
                0 if 'exact' in x.get('sources', []) else 1,
                x.get('metrics', {}).get('exact', {}).get('rank', float('inf')),
                x.get('metrics', {}).get('semantic', {}).get('rank', float('inf'))
            )
        )
        filtered_combined = []
        rank_counter = 1
        for item in combined_results:
            confidence = compute_final_confidence(item)
            item['final_score'] = confidence
            if confidence >= 0.3 or 'exact' in (item.get('sources') or []) or item.get('source') == 'exact':
                item['combined_rank'] = rank_counter
                filtered_combined.append(item)
                rank_counter += 1

        text_combined_results = filtered_combined

        image_threshold = 0.3
        image_results = search_image_vectors(query_text, top_k, threshold=image_threshold)

        combined_results: List[Dict[str, Any]] = []
        for entry in text_combined_results:
            combined_results.append(entry)
        for image_entry in image_results:
            combined_results.append(image_entry)

        for idx, entry in enumerate(combined_results, start=1):
            entry['combined_rank'] = idx

        response = {
            "status": "success",
            "query": query_text,
            "exact_match": {
                "total": len(exact_results),
                "results": exact_results
            },
            "semantic_match": {
                "total": len(semantic_results),
                "results": semantic_results,
                "bm25s_performed": bm25s_used,
                "rerank_performed": rerank_used
            },
            "combined": {
                "total": len(combined_results),
                "results": combined_results
            },
            "image_match": {
                "total": len(image_results),
                "results": image_results,
                "confidence_threshold": image_threshold
            },
            "bm25s_performed": bm25s_used,
            "rerank_performed": rerank_used
        }

        return response

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to search vectors with reranker: {str(e)}")
        raise HTTPException(status_code=500, detail=f"搜索失败: {str(e)}")


@router.post("/search-images")
async def search_images(request: SearchRequest) -> Dict[str, Any]:
    try:
        query_text = (request.query or '').strip()
        if not query_text:
            raise HTTPException(status_code=400, detail="查询内容不能为空")

        top_k = max(request.top_k or 10, 1)
        threshold = 0.3

        matches = search_image_vectors(query_text, top_k, threshold=threshold)

        return {
            "status": "success",
            "query": query_text,
            "total": len(matches),
            "image_match": {
                "total": len(matches),
                "results": matches,
                "confidence_threshold": threshold
            }
        }

    except HTTPException:
        raise
    except Exception as exc:
        logger.error("图片检索失败: %s", exc)
        raise HTTPException(status_code=500, detail=f"图片检索失败: {exc}")

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
