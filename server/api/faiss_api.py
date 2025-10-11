from fastapi import APIRouter, HTTPException
from typing import Dict, Any, List, Optional, Set, Tuple
from pathlib import Path
import numpy as np
import statistics
from service.faiss_service import FaissManager
from service.image_faiss_service import ImageFaissManager
from service.embedding_service import EmbeddingService
from service.clip_embedding_service import get_clip_embedding_service
from model.faiss_request_model import SearchRequest
import logging
from service.reranker_service import RerankerService
from service.bm25s_service import BM25SService
from config.config import ServerConfig

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/faiss", tags=["faiss"])

# 全局faiss管理器实例
faiss_manager = None
image_faiss_manager = None
embedding_service = None
reranker_service = None
bm25s_service = None

TEXT_DENSE_RECALL_MULTIPLIER = 10
TEXT_DENSE_RECALL_MIN = 120
TEXT_DENSE_RECALL_MAX = 400

TEXT_LEXICAL_RECALL_MULTIPLIER = 5
TEXT_LEXICAL_RECALL_MIN = 80
TEXT_LEXICAL_RECALL_MAX = 250

TEXT_RERANK_MULTIPLIER = 6
TEXT_RERANK_MIN = 60
TEXT_RERANK_MAX = 150

TEXT_MIN_COMPONENT_SCORE = 0.4
TEXT_MIN_FINAL_SCORE = 0.45
IMAGE_MIN_FINAL_SCORE = 0.45

FUSION_RERANK_WEIGHT = 0.6
FUSION_DENSE_WEIGHT = 0.25
FUSION_LEXICAL_WEIGHT = 0.15


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


def normalize_bm25_score(value: Optional[float]) -> Optional[float]:
    if value is None:
        return None
    try:
        val = float(value)
    except (TypeError, ValueError):
        return None
    if val <= 0.0 or np.isnan(val):
        return 0.0
    return clamp_unit(val / (val + 1.0))


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


def get_candidate_content(meta: Dict[str, Any]) -> str:
    content = meta.get('chunk_text') or meta.get('text') or meta.get('content') or ''
    return str(content)


def build_chunk_key(meta: Dict[str, Any]) -> Tuple:
    vector_id = meta.get('vector_id')
    if vector_id is not None:
        try:
            return ('vector', int(vector_id))
        except (TypeError, ValueError):
            pass
    file_path = meta.get('file_path') or meta.get('path') or ''
    chunk_index = meta.get('chunk_index')
    if file_path and chunk_index is not None:
        return ('chunk_index', file_path, int(chunk_index))
    chunk_id = meta.get('chunk_id') or meta.get('id')
    if file_path and chunk_id is not None:
        return ('chunk_id', file_path, chunk_id)
    content = get_candidate_content(meta)
    return ('chunk_text', file_path, content[:64])


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
        record['mixed_score'] = normalized_confidence
        record['quality_score'] = normalized_confidence
        record['score_breakdown'] = {'image': normalized_confidence}
        record['score_weights'] = {'image': 1.0}
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
        if record['final_score'] < IMAGE_MIN_FINAL_SCORE:
            continue
        matches.append(record)
        if len(matches) >= top_k:
            break

    return matches

def init_faiss_api(
    faiss_mgr: FaissManager,
    embedding_svc: EmbeddingService,
    image_faiss_mgr: ImageFaissManager,
    bm25s_svc: Optional[BM25SService] = None,
    reranker_svc: Optional[RerankerService] = None,
) -> None:
    """初始化Faiss API"""

    if image_faiss_mgr is None:
        raise ValueError("image_faiss_mgr must be provided")

    global faiss_manager, image_faiss_manager, embedding_service, reranker_service, bm25s_service
    faiss_manager = faiss_mgr
    image_faiss_manager = image_faiss_mgr
    embedding_service = embedding_svc
    reranker_service = reranker_svc
    bm25s_service = bm25s_svc

    if reranker_service:
        logger.info("Reranker服务已初始化")
    else:
        logger.info("未提供Reranker服务，将继续使用基础搜索")

    if not faiss_manager:
        logger.warning("Faiss管理器未提供，部分功能不可用")

    if bm25s_service:
        logger.info("BM25S服务已初始化，准备构建索引")
        if faiss_manager and faiss_manager.metadata:
            logger.info("开始构建BM25S索引，文档数量: %s", len(faiss_manager.metadata))
            try:
                documents: List[Dict[str, Any]] = []
                for index, meta in enumerate(faiss_manager.metadata):
                    content = meta.get('chunk_text', '') or meta.get('text', '')
                    if content:
                        documents.append({'id': str(index), 'content': content})

                logger.info("准备构建BM25S索引的文档数量: %s", len(documents))

                if documents:
                    bm25s_service.build_index(documents)
                    logger.info("BM25S索引构建完成，服务状态: available=%s", bm25s_service.is_available())
                else:
                    logger.warning("没有可用的文档内容用于构建BM25S索引")
            except Exception as exc:
                logger.error("构建BM25S索引时出错: %s", exc)
        else:
            logger.info("BM25S索引构建条件不满足，跳过构建")
    else:
        logger.info("未提供BM25S服务，将跳过BM25S索引构建")

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
    """综合字符匹配与语义检索的搜索接口，融合稀疏、稠密与重排序信号。"""
    try:
        if faiss_manager is None:
            raise HTTPException(status_code=500, detail="Faiss manager not initialized")

        if embedding_service is None:
            raise HTTPException(status_code=500, detail="Embedding service not initialized")

        top_k = max(request.top_k or 10, 1)
        query_text = (request.query or '').strip()
        if not query_text:
            raise HTTPException(status_code=400, detail="查询内容不能为空")

        bm25_weight_input = (
            request.bm25s_weight if request.bm25s_weight is not None else ServerConfig.BM25S_WEIGHT
        )
        embedding_weight_input = (
            request.embedding_weight if request.embedding_weight is not None else ServerConfig.EMBEDDING_WEIGHT
        )

        bm25_service = (
            bm25s_service if bm25s_service is not None and bm25s_service.is_available() else None
        )
        reranker = reranker_service if reranker_service is not None else None

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

        field_priorities = {
            'chunk_text': 0,
            'text': 0,
            'filename': 1,
            'file_path': 2
        }

        def build_match_preview(source_text: str, position: int, length: int, max_length: int = 160) -> str:
            if not source_text:
                return ''
            safe_position = max(0, position)
            safe_length = max(1, length)
            end_pos = safe_position + safe_length
            radius = max(20, (max_length - safe_length) // 2)
            start = max(0, safe_position - radius)
            end = min(len(source_text), end_pos + radius)
            snippet = source_text[start:end]
            prefix = '…' if start > 0 else ''
            suffix = '…' if end < len(source_text) else ''
            return f"{prefix}{snippet}{suffix}".strip()

        def perform_exact_match() -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
            exact_results: List[Dict[str, Any]] = []
            perfect_matches: List[Dict[str, Any]] = []
            seen_exact: Set[Tuple] = set()
            lowered = query_text.lower()

            for meta in faiss_manager.metadata or []:
                chunk_text = str(meta.get('chunk_text') or meta.get('text') or '')
                filename = str(meta.get('filename') or '')
                file_path = str(meta.get('file_path') or meta.get('path') or '')

                best_match: Optional[Dict[str, Any]] = None
                for field_name, candidate in (
                    ('chunk_text', chunk_text),
                    ('filename', filename),
                    ('file_path', file_path),
                ):
                    if not candidate:
                        continue
                    candidate_text = str(candidate)
                    position = candidate_text.lower().find(lowered)
                    if position == -1:
                        continue
                    match_info = {
                        'field': field_name,
                        'position': position,
                        'text': candidate_text,
                    }
                    if best_match is None:
                        best_match = match_info
                    else:
                        current_priority = field_priorities.get(best_match['field'], 99)
                        candidate_priority = field_priorities.get(field_name, 99)
                        if candidate_priority < current_priority:
                            best_match = match_info
                        elif candidate_priority == current_priority and position < best_match['position']:
                            best_match = match_info
                        elif (
                            candidate_priority == current_priority
                            and position == best_match['position']
                            and len(candidate_text) < len(best_match['text'])
                        ):
                            best_match = match_info

                if best_match is None or best_match['field'] == 'filename':
                    continue

                key = build_chunk_key(meta)
                if key in seen_exact:
                    continue
                seen_exact.add(key)

                match_length = len(query_text)
                match_preview = build_match_preview(best_match['text'], best_match['position'], match_length)
                rank = len(exact_results) + 1
                result = build_result(
                    meta,
                    'exact',
                    {
                        'rank': rank,
                        'match_position': best_match['position'],
                        'match_field': best_match['field'],
                        'match_length': match_length,
                        'match_preview': match_preview,
                        'match_score': 1.0,
                    },
                )
                exact_results.append(result)

                if chunk_text.strip().lower() == lowered:
                    perfect_matches.append(result)

            return exact_results, perfect_matches

        exact_results, perfect_exact_matches = perform_exact_match()
        if perfect_exact_matches:
            exact_results = perfect_exact_matches[:top_k]

        semantic_results: List[Dict[str, Any]] = []
        text_candidates: List[Dict[str, Any]] = []
        bm25_used = False
        rerank_used = False

        def collect_text_candidates() -> Tuple[List[Dict[str, Any]], bool, bool]:
            candidate_map: Dict[Tuple, Dict[str, Any]] = {}

            def ensure_candidate(meta: Dict[str, Any]) -> Optional[Dict[str, Any]]:
                if not meta:
                    return None
                key = build_chunk_key(meta)
                candidate = candidate_map.get(key)
                if candidate is not None:
                    return candidate
                content = get_candidate_content(meta).strip()
                if not content:
                    return None
                candidate_map[key] = {
                    'key': key,
                    'meta': dict(meta),
                    'content': content,
                    'sources': set(),
                    'embedding_score': None,
                    'embedding_norm': None,
                    'bm25_raw': None,
                    'bm25_norm': None,
                    'rerank_raw': None,
                    'rerank_norm': None,
                    'dense_rank': None,
                    'lexical_rank': None,
                    'rerank_rank': None,
                }
                return candidate_map[key]

            query_vector = embedding_service.encode_text(query_text)
            dense_limit = min(
                max(top_k * TEXT_DENSE_RECALL_MULTIPLIER, TEXT_DENSE_RECALL_MIN),
                TEXT_DENSE_RECALL_MAX,
            )
            dense_results: List[Dict[str, Any]] = []
            try:
                search_results = faiss_manager.search_vectors([query_vector], k=dense_limit)
                dense_results = search_results[0] if search_results else []
            except Exception as exc:  # pylint: disable=broad-except
                logger.error("文本向量检索失败: %s", exc)

            for idx, item in enumerate(dense_results[:dense_limit]):
                candidate = ensure_candidate(item)
                if not candidate:
                    continue
                candidate['sources'].add('dense')
                candidate['dense_rank'] = (
                    idx + 1 if candidate['dense_rank'] is None else min(candidate['dense_rank'], idx + 1)
                )
                score = item.get('score')
                if score is not None:
                    try:
                        raw_score = float(score)
                    except (TypeError, ValueError):
                        raw_score = None
                    if raw_score is not None:
                        candidate['embedding_score'] = raw_score
                        candidate['embedding_norm'] = normalize_embedding_score(raw_score)

            bm25_used_local = False
            if bm25_service is not None:
                lexical_limit = min(
                    max(top_k * TEXT_LEXICAL_RECALL_MULTIPLIER, TEXT_LEXICAL_RECALL_MIN),
                    TEXT_LEXICAL_RECALL_MAX,
                )
                try:
                    lexical_results = bm25_service.retrieve(query_text, top_k=lexical_limit)
                except Exception as exc:  # pylint: disable=broad-except
                    logger.warning("BM25检索失败: %s", exc)
                    lexical_results = []
                if lexical_results:
                    bm25_used_local = True
                for item in lexical_results:
                    doc_id = item.get('doc_id')
                    try:
                        doc_index = int(doc_id)
                    except (TypeError, ValueError):
                        continue
                    if doc_index < 0 or doc_index >= len(faiss_manager.metadata):
                        continue
                    meta = dict(faiss_manager.metadata[doc_index])
                    if meta.get('vector_id') is None:
                        meta['vector_id'] = meta.get('id') or doc_index
                    candidate = ensure_candidate(meta)
                    if not candidate:
                        continue
                    candidate['sources'].add('lexical')
                    rank_val = item.get('rank')
                    if isinstance(rank_val, int):
                        candidate['lexical_rank'] = (
                            rank_val if candidate['lexical_rank'] is None else min(candidate['lexical_rank'], rank_val)
                        )
                    raw_score = item.get('score')
                    if raw_score is not None:
                        try:
                            raw_val = float(raw_score)
                        except (TypeError, ValueError):
                            raw_val = None
                        if raw_val is not None:
                            candidate['bm25_raw'] = raw_val
                            candidate['bm25_norm'] = normalize_bm25_score(raw_val)

            candidates = list(candidate_map.values())
            if not candidates:
                return [], bm25_used_local, False

            if bm25_service is not None:
                corpus = [candidate['content'] for candidate in candidates]
                if any(text.strip() for text in corpus):
                    try:
                        bm25_scores = bm25_service.score_documents(query_text, corpus)
                    except Exception as exc:  # pylint: disable=broad-except
                        logger.warning("BM25评分失败: %s", exc)
                        bm25_scores = []
                    else:
                        if bm25_scores:
                            bm25_used_local = True
                        for candidate, score in zip(candidates, bm25_scores):
                            try:
                                raw_val = float(score)
                            except (TypeError, ValueError):
                                continue
                            candidate['bm25_raw'] = raw_val
                            candidate['bm25_norm'] = normalize_bm25_score(raw_val)

            for candidate in candidates:
                emb_norm = candidate.get('embedding_norm') or 0.0
                bm_norm = candidate.get('bm25_norm') or 0.0
                candidate['pre_score'] = emb_norm + bm_norm

            rerank_used_local = False
            if reranker is not None and candidates:
                rerank_candidates = [cand for cand in candidates if cand.get('content')]
                rerank_candidates.sort(
                    key=lambda c: (
                        c.get('pre_score', 0.0),
                        c.get('embedding_norm') or 0.0,
                        c.get('bm25_norm') or 0.0,
                    ),
                    reverse=True,
                )
                rerank_limit = min(
                    max(top_k * TEXT_RERANK_MULTIPLIER, TEXT_RERANK_MIN),
                    TEXT_RERANK_MAX,
                    len(rerank_candidates),
                )
                if rerank_limit > 0:
                    try:
                        rerank_scores = reranker.rerank_results(
                            query_text,
                            [cand['content'] for cand in rerank_candidates[:rerank_limit]],
                            normalize=True,
                        )
                    except Exception as exc:  # pylint: disable=broad-except
                        logger.warning("重排序模型评分失败: %s", exc)
                        rerank_scores = []
                    if rerank_scores:
                        rerank_used_local = True
                        for idx, (cand, score) in enumerate(zip(rerank_candidates[:rerank_limit], rerank_scores)):
                            try:
                                raw_val = float(score)
                            except (TypeError, ValueError):
                                raw_val = 0.0
                            normalized = clamp_unit(raw_val)
                            cand['sources'].add('reranker')
                            cand['rerank_raw'] = raw_val
                            cand['rerank_norm'] = normalized
                            cand['rerank_rank'] = idx + 1

            try:
                bm25_weight = max(0.0, float(bm25_weight_input))
            except (TypeError, ValueError):
                bm25_weight = ServerConfig.BM25S_WEIGHT
            try:
                embedding_weight = max(0.0, float(embedding_weight_input))
            except (TypeError, ValueError):
                embedding_weight = ServerConfig.EMBEDDING_WEIGHT
            rerank_weight = FUSION_RERANK_WEIGHT if rerank_used_local else 0.0

            for candidate in candidates:
                breakdown: Dict[str, float] = {}
                emb_norm = candidate.get('embedding_norm')
                bm_norm = candidate.get('bm25_norm')
                rerank_norm = candidate.get('rerank_norm')
                if emb_norm is not None:
                    breakdown['dense'] = emb_norm
                    candidate['sources'].add('dense')
                if bm_norm is not None:
                    breakdown['lexical'] = bm_norm
                if rerank_norm is not None:
                    breakdown['reranker'] = rerank_norm

                weights: Dict[str, float] = {}
                if 'dense' in breakdown and embedding_weight > 0:
                    weights['dense'] = embedding_weight
                if 'lexical' in breakdown and bm25_weight > 0:
                    weights['lexical'] = bm25_weight
                if 'reranker' in breakdown and rerank_weight > 0:
                    weights['reranker'] = rerank_weight

                if not weights:
                    final_score = breakdown.get('dense')
                    if final_score is None:
                        final_score = breakdown.get('lexical', 0.0)
                    score_weights = None
                else:
                    total_weight = sum(weights.values())
                    if total_weight <= 0:
                        total_weight = float(len(weights))
                        weights = {key: 1.0 for key in weights}
                    score_weights = {key: value / total_weight for key, value in weights.items()}
                    final_score = 0.0
                    for key, weight in score_weights.items():
                        component = breakdown.get(key)
                        if component is not None:
                            final_score += component * weight

                candidate['score_breakdown'] = breakdown or None
                candidate['score_weights'] = score_weights or None
                candidate['final_score'] = float(final_score or 0.0)

            candidates.sort(
                key=lambda c: (
                    c.get('final_score', 0.0),
                    c.get('rerank_norm') or 0.0,
                    c.get('embedding_norm') or 0.0,
                    c.get('bm25_norm') or 0.0,
                ),
                reverse=True,
            )
            return candidates, bm25_used_local, rerank_used_local

        if not perfect_exact_matches:
            text_candidates, bm25_used, rerank_used = collect_text_candidates()

        def serialize_candidate(candidate: Dict[str, Any], rank: int) -> Dict[str, Any]:
            sources = sorted(candidate.get('sources') or [])
            breakdown = candidate.get('score_breakdown') or {}
            weights = candidate.get('score_weights') or {}
            result = build_result(
                candidate.get('meta', {}),
                'semantic',
                {
                    'rank': rank,
                    'embedding_score': candidate.get('embedding_score'),
                    'embedding_score_normalized': candidate.get('embedding_norm'),
                    'bm25s_raw_score': candidate.get('bm25_raw'),
                    'bm25s_score': candidate.get('bm25_norm'),
                    'rerank_score': candidate.get('rerank_raw'),
                    'rerank_score_normalized': candidate.get('rerank_norm'),
                    'mixed_score': candidate.get('final_score'),
                    'quality_score': candidate.get('final_score'),
                    'final_score': candidate.get('final_score'),
                    'dense_rank': candidate.get('dense_rank'),
                    'lexical_rank': candidate.get('lexical_rank'),
                    'rerank_rank': candidate.get('rerank_rank'),
                    'score_breakdown': breakdown or None,
                    'score_weights': weights or None,
                    'sources': sources,
                },
            )
            metrics = {
                'rank': rank,
                'embedding_score': candidate.get('embedding_score'),
                'embedding_score_normalized': candidate.get('embedding_norm'),
                'bm25s_score': candidate.get('bm25_norm'),
                'bm25s_raw_score': candidate.get('bm25_raw'),
                'mixed_score': candidate.get('final_score'),
                'rerank_score': candidate.get('rerank_raw'),
                'rerank_score_normalized': candidate.get('rerank_norm'),
                'dense_rank': candidate.get('dense_rank'),
                'lexical_rank': candidate.get('lexical_rank'),
                'rerank_rank': candidate.get('rerank_rank'),
            }
            result.setdefault('metrics', {})
            result['metrics']['semantic'] = metrics
            return result

        def _candidate_passes(candidate: Dict[str, Any]) -> bool:
            components = [
                candidate.get('embedding_norm'),
                candidate.get('bm25_norm'),
                candidate.get('rerank_norm'),
            ]
            for comp in components:
                if comp is not None and comp < TEXT_MIN_COMPONENT_SCORE:
                    return False
            return (candidate.get('final_score') or 0.0) >= TEXT_MIN_FINAL_SCORE

        filtered_candidates = [candidate for candidate in text_candidates if _candidate_passes(candidate)]

        for idx, candidate in enumerate(filtered_candidates[:top_k], start=1):
            semantic_results.append(serialize_candidate(candidate, idx))

        combined_results: List[Dict[str, Any]] = []
        for item in exact_results:
            entry = dict(item)
            entry.setdefault('sources', ['exact'])
            entry['final_score'] = compute_final_confidence(entry)
            combined_results.append(entry)
        for item in semantic_results:
            combined_entry = dict(item)
            combined_results.append(combined_entry)

        image_threshold = 0.3
        image_results = search_image_vectors(query_text, top_k, threshold=image_threshold)
        for image_entry in image_results:
            combined_results.append(image_entry)

        combined_results.sort(
            key=lambda entry: entry.get('final_score', 0.0),
            reverse=True,
        )

        for idx, entry in enumerate(combined_results, start=1):
            entry['combined_rank'] = idx
            entry.setdefault('final_score', compute_final_confidence(entry))

        response = {
            'status': 'success',
            'query': query_text,
            'exact_match': {
                'total': len(exact_results),
                'results': exact_results,
            },
            'semantic_match': {
                'total': len(semantic_results),
                'results': semantic_results,
                'bm25s_performed': bm25_used,
                'rerank_performed': rerank_used,
            },
            'combined': {
                'total': len(combined_results),
                'results': combined_results,
            },
            'image_match': {
                'total': len(image_results),
                'results': image_results,
            },
        }
        return response

    except HTTPException:
        raise
    except Exception as exc:  # pylint: disable=broad-except
        logger.error(f"Failed to search vectors with reranker: {str(exc)}")
        raise HTTPException(status_code=500, detail=f"搜索失败: {str(exc)}")


@router.post("/search-images")
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
