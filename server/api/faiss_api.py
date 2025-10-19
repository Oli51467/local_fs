from fastapi import APIRouter, HTTPException
from typing import Dict, Any, List, Optional, Set, Tuple
from pathlib import Path
import numpy as np
import statistics
import re
from service.faiss_service import FaissManager
from service.image_faiss_service import ImageFaissManager
from service.embedding_service import EmbeddingService
from service.clip_embedding_service import get_clip_embedding_service
from model.faiss_request_model import SearchRequest
import logging
from service.reranker_service import RerankerService
from service.bm25s_service import BM25SService
from config.config import ServerConfig
from service.sqlite_service import SQLiteManager

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/faiss", tags=["faiss"])

# 全局faiss管理器实例
faiss_manager = None
image_faiss_manager = None
embedding_service = None
reranker_service = None
bm25s_service = None
sqlite_manager = None

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
TEXT_MIN_FINAL_SCORE = 0.55
TEXT_STRONG_RERANK_THRESHOLD = 0.55
TEXT_STRONG_DENSE_THRESHOLD = 0.6
TEXT_STRONG_LEXICAL_THRESHOLD = 0.5
TEXT_STRONG_CLIP_THRESHOLD = 0.58
TEXT_STRONG_FINAL_THRESHOLD = 0.62
TEXT_RELATIVE_KEEP_FACTOR = 0.75
CLIP_TEXT_TRUNCATE = 512
CLIP_CANDIDATE_LIMIT = 220
IMAGE_MIN_FINAL_SCORE = 0.45
IMAGE_MIN_COMPONENT_SCORE = 0.35
IMAGE_CLIP_WEIGHT = 0.4
IMAGE_DENSE_WEIGHT = 0.25
IMAGE_RERANK_WEIGHT = 0.25
IMAGE_LEXICAL_WEIGHT = 0.1
IMAGE_TEXT_CANDIDATE_LIMIT = 160
IMAGE_CONTEXT_SNIPPET = 240

FUSION_RERANK_WEIGHT = 0.45
FUSION_DENSE_WEIGHT = 0.3
FUSION_LEXICAL_WEIGHT = 0.15
FUSION_CLIP_WEIGHT = 0.1


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


def deduplicate_results(entries: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    seen: Set[Tuple] = set()
    deduped: List[Dict[str, Any]] = []
    for entry in entries:
        key = build_chunk_key(entry)
        if key in seen:
            continue
        seen.add(key)
        deduped.append(entry)
    return deduped


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

    def _contains_non_latin(text: str) -> bool:
        return any(ord(ch) > 127 for ch in text)

    def _collect_chinese_prompts(text: str) -> List[str]:
        chinese_templates = [
            "一张{query}的照片",
            "{query}的图片",
            "与{query}相关的图像",
            "描绘{query}的照片",
        ]
        return [tpl.format(query=text.strip()) for tpl in chinese_templates if text.strip()]

    def _extract_ascii_keywords(*texts: str) -> List[str]:
        keywords: List[str] = []
        seen: Set[str] = set()
        pattern = re.compile(r"[A-Za-z]{3,}")
        for text in texts:
            if not text:
                continue
            for match in pattern.findall(text):
                lowered = match.lower()
                if lowered in seen:
                    continue
                seen.add(lowered)
                keywords.append(lowered)
        return keywords

    def _augment_prompts_from_text() -> List[str]:
        if embedding_service is None or faiss_manager is None:
            return []

        try:
            dense_query = embedding_service.encode_text(base_query)
        except Exception as exc:  # pylint: disable=broad-except
            logger.debug("生成图像检索文本桥接向量失败: %s", exc)
            return []

        dense_vec = np.asarray(dense_query, dtype=np.float32)
        norm = float(np.linalg.norm(dense_vec))
        if norm <= 0:
            return []
        dense_vec = (dense_vec / norm).reshape(1, -1)

        try:
            recall_size = min(max(top_k * 8, 80), max(len(faiss_manager.metadata), 80))
            text_results = faiss_manager.search_vectors(dense_vec.tolist(), k=recall_size)
        except Exception as exc:  # pylint: disable=broad-except
            logger.debug("图像检索文本桥接失败: %s", exc)
            return []

        if not text_results or not text_results[0]:
            return []

        keyword_candidates: List[str] = []
        for entry in text_results[0]:
            chunk_text = entry.get("chunk_text") or entry.get("text") or ""
            filename = entry.get("filename") or ""
            keyword_candidates.extend(_extract_ascii_keywords(chunk_text, filename))
            if len(keyword_candidates) >= 24:
                break

        if not keyword_candidates:
            return []

        unique_keywords: List[str] = []
        seen_kw: Set[str] = set()
        for keyword in keyword_candidates:
            if keyword in seen_kw:
                continue
            seen_kw.add(keyword)
            unique_keywords.append(keyword)
            if len(unique_keywords) >= 12:
                break

        extra_prompts: List[str] = []
        for keyword in unique_keywords:
            extra_prompts.append(keyword)
            extra_prompts.append(f"a photo of {keyword}")
            extra_prompts.append(f"an image showing {keyword}")
        return extra_prompts

    if _contains_non_latin(base_query):
        prompt_candidates.extend(_collect_chinese_prompts(base_query))
        prompt_candidates.extend(_augment_prompts_from_text())

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

    project_root = ServerConfig.PROJECT_ROOT.resolve()
    chunk_cache: Dict[Tuple[int, int], Optional[Dict[str, Any]]] = {}

    def _truncate_text(text: str, limit: int = IMAGE_CONTEXT_SNIPPET) -> str:
        if not text:
            return ""
        normalized = str(text).strip()
        if len(normalized) <= limit:
            return normalized
        return normalized[:limit].rstrip() + "…"

    def _get_chunk_record(
        document_id: int,
        chunk_index: int,
    ) -> Optional[Dict[str, Any]]:
        cache_key = (document_id, chunk_index)
        if cache_key in chunk_cache:
            return chunk_cache[cache_key]
        if sqlite_manager is None:
            chunk_cache[cache_key] = None
            return None
        try:
            record = sqlite_manager.get_chunk_by_document_and_index(
                int(document_id), int(chunk_index)
            )
        except Exception as exc:  # pylint: disable=broad-except
            logger.debug(
                "获取图片关联文档片段失败(document_id=%s, chunk_index=%s): %s",
                document_id,
                chunk_index,
                exc,
            )
            record = None
        chunk_cache[cache_key] = record
        return record

    enriched: List[Dict[str, Any]] = []

    candidates = search_results[0] if search_results else []
    for clip_rank, candidate in enumerate(candidates, start=1):
        vector_index = candidate.get('vector_id')
        # vector_id is stored separately; fallback to faiss index position
        faiss_index = (
            candidate.get('vector_id')
            if candidate.get('vector_id') is not None
            else clip_rank - 1
        )

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
        record['_sources'] = {'image', 'clip'}
        record['vector_index'] = int(faiss_index)
        record.setdefault('vector_id', int(faiss_index))
        record['cosine_similarity'] = best_cosine
        record['avg_cosine'] = average_cosine
        record['combined_cosine'] = combined_cosine
        record['clip_score'] = combined_cosine
        record['clip_norm'] = normalized_confidence
        record['clip_rank'] = clip_rank
        record['confidence'] = normalized_confidence
        record['image_score'] = combined_cosine
        record['final_score'] = normalized_confidence
        record['mixed_score'] = normalized_confidence
        record['quality_score'] = normalized_confidence
        record['score_breakdown'] = {'clip': normalized_confidence}
        record['score_weights'] = {'clip': 1.0}
        record['rank'] = clip_rank
        record['metrics'] = {
            'image': {
                'rank': clip_rank,
                'confidence': normalized_confidence,
                'best_cosine': best_cosine,
                'avg_cosine': average_cosine,
                'combined_cosine': combined_cosine
            }
        }
        record.setdefault('filename', record.get('image_name'))
        record.setdefault('display_name', record.get('image_name'))
        if sqlite_manager is not None:
            document_allowed = False
            doc_id_raw = record.get('document_id')
            if doc_id_raw is not None:
                try:
                    document_allowed = sqlite_manager.get_document_by_id(int(doc_id_raw)) is not None
                except Exception as exc:  # pylint: disable=broad-except
                    logger.debug("图片结果文档校验失败(ID=%s): %s", doc_id_raw, exc)
                    document_allowed = False
            if not document_allowed:
                candidate_path = record.get('file_path') or record.get('path') or record.get('source_path')
                if candidate_path:
                    try:
                        document_allowed = sqlite_manager.get_document_by_path(str(candidate_path)) is not None
                    except Exception as exc:  # pylint: disable=broad-except
                        logger.debug("图片结果路径校验失败(%s): %s", candidate_path, exc)
                        document_allowed = False
            if not document_allowed:
                continue
        enriched.append(record)

    if not enriched:
        return []

    text_candidates: List[Dict[str, Any]] = []

    for record in enriched:
        doc_id_raw = record.get('document_id')
        chunk_index_raw = record.get('chunk_index')
        chunk_text: Optional[str] = None
        if doc_id_raw is not None and chunk_index_raw is not None:
            try:
                doc_id_int = int(doc_id_raw)
                chunk_index_int = int(chunk_index_raw)
            except (TypeError, ValueError):
                doc_id_int = None
                chunk_index_int = None
            if doc_id_int is not None and chunk_index_int is not None:
                chunk_record = _get_chunk_record(doc_id_int, chunk_index_int)
                if chunk_record and chunk_record.get('content'):
                    chunk_text = str(chunk_record.get('content') or '').strip()
                    record.setdefault('filename', chunk_record.get('filename'))
                    record.setdefault('file_path', chunk_record.get('file_path'))
                    record.setdefault('chunk_vector_id', chunk_record.get('vector_id'))

        alt_text = str(record.get('alt_text') or record.get('caption') or '').strip()
        if chunk_text:
            record['chunk_text'] = chunk_text
        context_parts: List[str] = []
        if alt_text:
            context_parts.append(alt_text)
        if chunk_text:
            context_parts.append(chunk_text)
        fallback_name = record.get('filename') or record.get('image_name')
        if not context_parts and fallback_name:
            context_parts.append(str(fallback_name))

        context_text = "\n".join(part for part in context_parts if part).strip()
        record['context_text'] = context_text
        preview_source = chunk_text or alt_text or context_text
        if preview_source:
            record['match_preview'] = _truncate_text(preview_source, IMAGE_CONTEXT_SNIPPET)

        if context_text:
            text_candidates.append(record)

    limited_text_candidates = text_candidates[:IMAGE_TEXT_CANDIDATE_LIMIT]

    # 密集向量评分
    if embedding_service is not None and limited_text_candidates:
        try:
            query_vec_raw = embedding_service.encode_text(query_text)
        except Exception as exc:  # pylint: disable=broad-except
            logger.debug("生成图像检索文本查询向量失败: %s", exc)
            query_vec_raw = None
        query_vec: Optional[np.ndarray] = None
        if query_vec_raw:
            query_vec = np.asarray(query_vec_raw, dtype=np.float32)
            norm = float(np.linalg.norm(query_vec))
            if norm > 0:
                query_vec = query_vec / norm
            else:
                query_vec = None

        if query_vec is not None:
            try:
                candidate_vecs = embedding_service.encode_texts(
                    [item['context_text'] for item in limited_text_candidates]
                )
            except Exception as exc:  # pylint: disable=broad-except
                logger.debug("生成图像候选文本向量失败: %s", exc)
                candidate_vecs = []

            for record, vec in zip(limited_text_candidates, candidate_vecs):
                doc_vec = np.asarray(vec, dtype=np.float32)
                doc_norm = float(np.linalg.norm(doc_vec))
                if doc_norm <= 0:
                    continue
                cosine_sim = float(np.dot(doc_vec, query_vec) / doc_norm)
                record['embedding_score'] = cosine_sim
                record['embedding_norm'] = normalize_embedding_score(cosine_sim)
                record['_sources'].add('dense')

    # 稀疏检索评分
    if (
        bm25s_service is not None
        and bm25s_service.is_available()
        and limited_text_candidates
    ):
        try:
            bm25_scores = bm25s_service.score_documents(
                query_text, [item['context_text'] for item in limited_text_candidates]
            )
        except Exception as exc:  # pylint: disable=broad-except
            logger.debug("计算图像候选BM25分数失败: %s", exc)
            bm25_scores = []
        for record, score in zip(limited_text_candidates, bm25_scores):
            record['bm25_raw'] = float(score)
            normalized = normalize_bm25_score(score)
            record['bm25_norm'] = normalized
            if normalized not in (None, 0):
                record['_sources'].add('lexical')

    # Reranker评分
    if reranker_service is not None and limited_text_candidates:
        try:
            rerank_scores = reranker_service.rerank_results(
                query_text,
                [item['context_text'] for item in limited_text_candidates],
                normalize=True,
            )
        except Exception as exc:  # pylint: disable=broad-except
            logger.debug("图像候选重排序失败: %s", exc)
            rerank_scores = []
        for record, score in zip(limited_text_candidates, rerank_scores):
            normalized = clamp_unit(score)
            record['rerank_score'] = float(score)
            record['rerank_norm'] = normalized
            if normalized not in (None, 0):
                record['_sources'].add('reranker')

    # 组件排名
    dense_sorted = sorted(
        [item for item in enriched if item.get('embedding_norm') is not None],
        key=lambda data: data.get('embedding_norm', 0.0),
        reverse=True,
    )
    for rank, record in enumerate(dense_sorted, start=1):
        record['dense_rank'] = rank

    lexical_sorted = sorted(
        [item for item in enriched if item.get('bm25_norm') is not None],
        key=lambda data: data.get('bm25_norm', 0.0),
        reverse=True,
    )
    for rank, record in enumerate(lexical_sorted, start=1):
        record['lexical_rank'] = rank

    rerank_sorted = sorted(
        [item for item in enriched if item.get('rerank_norm') is not None],
        key=lambda data: data.get('rerank_norm', 0.0),
        reverse=True,
    )
    for rank, record in enumerate(rerank_sorted, start=1):
        record['rerank_rank'] = rank

    filtered: List[Dict[str, Any]] = []
    for record in enriched:
        clip_norm = record.get('clip_norm')
        dense_norm = record.get('embedding_norm')
        rerank_norm = record.get('rerank_norm')
        bm_norm = record.get('bm25_norm')

        components = [
            value
            for value in (clip_norm, dense_norm, rerank_norm, bm_norm)
            if value is not None
        ]
        if not components:
            continue

        weight_sum = 0.0
        fused_score = 0.0

        if clip_norm is not None:
            fused_score += clip_norm * IMAGE_CLIP_WEIGHT
            weight_sum += IMAGE_CLIP_WEIGHT
        if dense_norm is not None:
            fused_score += dense_norm * IMAGE_DENSE_WEIGHT
            weight_sum += IMAGE_DENSE_WEIGHT
        if rerank_norm is not None:
            fused_score += rerank_norm * IMAGE_RERANK_WEIGHT
            weight_sum += IMAGE_RERANK_WEIGHT
        if bm_norm is not None:
            fused_score += bm_norm * IMAGE_LEXICAL_WEIGHT
            weight_sum += IMAGE_LEXICAL_WEIGHT

        if weight_sum > 0:
            final_score = clamp_unit(fused_score / weight_sum)
        else:
            final_score = clamp_unit(max(components))

        record['final_score'] = final_score
        record['confidence'] = final_score
        record['mixed_score'] = final_score
        record['quality_score'] = final_score
        record['metrics']['image'].update(
            {
                'confidence': final_score,
                'clip_score': record.get('clip_score'),
                'clip_score_normalized': record.get('clip_norm'),
            }
        )

        breakdown: Dict[str, float] = {}
        if clip_norm is not None:
            breakdown['clip'] = clip_norm
        if dense_norm is not None:
            breakdown['dense'] = dense_norm
        if rerank_norm is not None:
            breakdown['reranker'] = rerank_norm
        if bm_norm is not None:
            breakdown['lexical'] = bm_norm
        record['score_breakdown'] = breakdown or None

        if weight_sum > 0:
            weights: Dict[str, float] = {}
            if clip_norm is not None:
                weights['clip'] = IMAGE_CLIP_WEIGHT / weight_sum
            if dense_norm is not None:
                weights['dense'] = IMAGE_DENSE_WEIGHT / weight_sum
            if rerank_norm is not None:
                weights['reranker'] = IMAGE_RERANK_WEIGHT / weight_sum
            if bm_norm is not None:
                weights['lexical'] = IMAGE_LEXICAL_WEIGHT / weight_sum
            record['score_weights'] = weights or None
        else:
            record['score_weights'] = None

        if max(components) < IMAGE_MIN_COMPONENT_SCORE:
            continue
        if record['final_score'] < IMAGE_MIN_FINAL_SCORE:
            continue

        filtered.append(record)

    if not filtered:
        return []

    filtered.sort(
        key=lambda item: (
            item.get('final_score', 0.0),
            item.get('rerank_norm') or 0.0,
            item.get('clip_norm') or 0.0,
            item.get('embedding_norm') or 0.0,
        ),
        reverse=True,
    )

    matches: List[Dict[str, Any]] = []
    for rank, record in enumerate(filtered[:top_k], start=1):
        record['rank'] = rank
        record['metrics']['image']['rank'] = rank

        if any(
            record.get(key) is not None
            for key in ('embedding_norm', 'bm25_norm', 'rerank_norm')
        ):
            semantic_metrics = {
                'rank': rank,
                'embedding_score': record.get('embedding_score'),
                'embedding_score_normalized': record.get('embedding_norm'),
                'bm25s_raw_score': record.get('bm25_raw'),
                'bm25s_score': record.get('bm25_norm'),
                'rerank_score': record.get('rerank_score'),
                'rerank_score_normalized': record.get('rerank_norm'),
                'dense_rank': record.get('dense_rank'),
                'lexical_rank': record.get('lexical_rank'),
                'rerank_rank': record.get('rerank_rank'),
                'mixed_score': record.get('final_score'),
            }
            record.setdefault('metrics', {})
            record['metrics']['semantic'] = semantic_metrics

        record['sources'] = sorted(record.get('_sources') or [])
        record.pop('_sources', None)
        record.pop('context_text', None)
        matches.append(record)

    return matches

def init_faiss_api(
    faiss_mgr: FaissManager,
    embedding_svc: EmbeddingService,
    image_faiss_mgr: ImageFaissManager,
    bm25s_svc: Optional[BM25SService] = None,
    reranker_svc: Optional[RerankerService] = None,
    sqlite_svc: Optional[SQLiteManager] = None,
) -> None:
    """初始化Faiss API"""

    if image_faiss_mgr is None:
        raise ValueError("image_faiss_mgr must be provided")

    global faiss_manager, image_faiss_manager, embedding_service, reranker_service, bm25s_service, sqlite_manager
    faiss_manager = faiss_mgr
    image_faiss_manager = image_faiss_mgr
    embedding_service = embedding_svc
    reranker_service = reranker_svc
    bm25s_service = bm25s_svc
    sqlite_manager = sqlite_svc

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
        sqlite_service = sqlite_manager if sqlite_manager is not None else None

        chunk_cache: Dict[int, Optional[Dict[str, Any]]] = {}
        document_cache: Dict[str, Optional[Dict[str, Any]]] = {}
        document_id_cache: Dict[int, Optional[Dict[str, Any]]] = {}
        meta_cache: Dict[int, Optional[Dict[str, Any]]] = {}

        def get_chunk_record(vector_id: Optional[int]) -> Optional[Dict[str, Any]]:
            if vector_id is None:
                return None
            if vector_id in chunk_cache:
                return chunk_cache[vector_id]
            if sqlite_service is None:
                chunk_cache[vector_id] = None
                return None
            try:
                record = sqlite_service.get_chunk_by_vector_id(int(vector_id))
            except Exception as exc:  # pylint: disable=broad-except
                logger.warning("查询向量ID对应的块失败(%s): %s", vector_id, exc)
                record = None
            chunk_cache[vector_id] = record
            return record

        def get_document_record(file_path: str) -> Optional[Dict[str, Any]]:
            normalized = (file_path or '').strip()
            if not normalized:
                return None
            cached = document_cache.get(normalized)
            if cached is not None or normalized in document_cache:
                return cached
            if sqlite_service is None:
                document_cache[normalized] = {}
                return document_cache[normalized]
            try:
                document = sqlite_service.get_document_by_path(normalized)
            except Exception as exc:  # pylint: disable=broad-except
                logger.warning("查询文档路径失败(%s): %s", normalized, exc)
                document = None
            document_cache[normalized] = document
            return document

        def get_document_record_by_id(document_id: Optional[int]) -> Optional[Dict[str, Any]]:
            if document_id is None:
                return None
            if document_id in document_id_cache:
                return document_id_cache[document_id]
            if sqlite_service is None:
                document_id_cache[document_id] = {}
                return document_id_cache[document_id]
            try:
                document = sqlite_service.get_document_by_id(int(document_id))
            except Exception as exc:  # pylint: disable=broad-except
                logger.warning("根据ID查询文档失败(%s): %s", document_id, exc)
                document = None
            document_id_cache[document_id] = document
            return document

        def resolve_meta(meta: Dict[str, Any]) -> Optional[Dict[str, Any]]:
            if not meta:
                return None
            vector_id_raw = meta.get('vector_id')
            vector_id_val: Optional[int] = None
            if vector_id_raw is not None:
                cache_key = None
                try:
                    vector_id_val = int(vector_id_raw)
                    cache_key = vector_id_val
                except (TypeError, ValueError):
                    vector_id_val = None
                if cache_key is not None and cache_key in meta_cache:
                    return meta_cache[cache_key]

            data = dict(meta)
            if sqlite_service is None:
                if vector_id_val is not None:
                    meta_cache[vector_id_val] = data
                return data

            chunk_record = get_chunk_record(vector_id_val)
            if chunk_record:
                data['vector_id'] = chunk_record.get('vector_id', vector_id_val)
                data['document_id'] = chunk_record.get('document_id')
                data['filename'] = chunk_record.get('filename') or data.get('filename')
                data['file_path'] = chunk_record.get('file_path') or data.get('file_path')
                data['chunk_index'] = chunk_record.get('chunk_index')
                chunk_content = chunk_record.get('content')
                if chunk_content:
                    data['chunk_text'] = chunk_content
                if vector_id_val is not None:
                    meta_cache[vector_id_val] = data
                return data

            document_id_raw = data.get('document_id')
            document_id_val: Optional[int] = None
            if document_id_raw is not None:
                try:
                    document_id_val = int(document_id_raw)
                except (TypeError, ValueError):
                    document_id_val = None
                if document_id_val is not None:
                    document_record = get_document_record_by_id(document_id_val)
                    if document_record:
                        data['document_id'] = document_record.get('id', document_id_val)
                        data.setdefault('filename', document_record.get('filename'))
                        data['file_path'] = document_record.get('file_path') or data.get('file_path')
                        if vector_id_val is not None:
                            meta_cache[vector_id_val] = data
                        return data

            file_path = data.get('file_path') or data.get('path')
            if not file_path:
                if vector_id_val is not None:
                    meta_cache[vector_id_val] = None
                return None

            document_record = get_document_record(str(file_path))
            if document_record is None:
                if vector_id_val is not None:
                    meta_cache[vector_id_val] = None
                return None

            data.setdefault('document_id', document_record.get('id'))
            data.setdefault('filename', document_record.get('filename'))
            data['file_path'] = document_record.get('file_path') or str(file_path)
            if vector_id_val is not None:
                meta_cache[vector_id_val] = data
            return data

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

            chunk_records: List[Dict[str, Any]] = []
            if sqlite_service is not None:
                try:
                    chunk_records = sqlite_service.search_chunks_by_substring(query_text)
                except Exception as exc:  # pylint: disable=broad-except
                    logger.warning("字符匹配查询失败: %s", exc)
                    chunk_records = []

            def append_match(meta_source: Dict[str, Any], field_name: str, candidate_text: Any) -> None:
                if not candidate_text:
                    return
                candidate_text_str = str(candidate_text)
                position = candidate_text_str.lower().find(lowered)
                if position == -1:
                    return

                meta = dict(meta_source)
                key = build_chunk_key(meta)
                if key in seen_exact:
                    return

                match_length = len(query_text)
                match_preview = build_match_preview(candidate_text_str, position, match_length)
                rank = len(exact_results) + 1
                result = build_result(
                    meta,
                    'exact',
                    {
                        'rank': rank,
                        'match_position': position,
                        'match_field': field_name,
                        'match_length': match_length,
                        'match_preview': match_preview,
                        'match_score': 1.0,
                    },
                )
                exact_results.append(result)
                seen_exact.add(key)

                if field_name == 'chunk_text':
                    chunk_value = str(meta.get('chunk_text') or meta.get('text') or '').strip().lower()
                    if chunk_value == lowered:
                        perfect_matches.append(result)

            for record in chunk_records:
                chunk_text = str(record.get('content') or '')
                meta_payload: Dict[str, Any] = {
                    'document_id': record.get('document_id'),
                    'filename': record.get('filename') or '',
                    'file_path': record.get('file_path') or '',
                    'file_type': record.get('file_type'),
                    'chunk_index': record.get('chunk_index'),
                    'chunk_text': chunk_text,
                    'vector_id': record.get('vector_id'),
                    'chunk_id': record.get('chunk_id'),
                }
                append_match(meta_payload, 'chunk_text', chunk_text)

            include_chunk_text_from_metadata = not chunk_records
            for meta in faiss_manager.metadata or []:
                resolved_meta = resolve_meta(meta)
                if not resolved_meta:
                    continue
                if include_chunk_text_from_metadata:
                    append_match(
                        resolved_meta,
                        'chunk_text',
                        resolved_meta.get('chunk_text') or resolved_meta.get('text') or '',
                    )
                append_match(resolved_meta, 'filename', resolved_meta.get('filename') or '')
                append_match(
                    resolved_meta,
                    'file_path',
                    resolved_meta.get('file_path') or resolved_meta.get('path') or '',
                )

            return exact_results, perfect_matches

        exact_results, perfect_exact_matches = perform_exact_match()
        if perfect_exact_matches:
            perfect_keys = {build_chunk_key(item) for item in perfect_exact_matches}
            remaining_exact = [
                item for item in exact_results if build_chunk_key(item) not in perfect_keys
            ]
            exact_results = perfect_exact_matches + remaining_exact

        for idx, exact_entry in enumerate(exact_results, start=1):
            exact_entry['rank'] = idx

        semantic_results: List[Dict[str, Any]] = []
        text_candidates: List[Dict[str, Any]] = []
        bm25_used = False
        rerank_used = False
        clip_used = False

        def collect_text_candidates() -> Tuple[List[Dict[str, Any]], bool, bool, bool]:
            candidate_map: Dict[Tuple, Dict[str, Any]] = {}

            def ensure_candidate(meta: Dict[str, Any]) -> Optional[Dict[str, Any]]:
                if not meta:
                    return None
                resolved_meta = resolve_meta(meta)
                if not resolved_meta:
                    return None
                key = build_chunk_key(resolved_meta)
                candidate = candidate_map.get(key)
                if candidate is not None:
                    return candidate
                content = get_candidate_content(resolved_meta).strip()
                if not content:
                    return None
                candidate_map[key] = {
                    'key': key,
                    'meta': resolved_meta,
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
                    'clip_score': None,
                    'clip_norm': None,
                    'clip_rank': None,
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
            clip_used_local = False
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
                return [], bm25_used_local, False, clip_used_local

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

            clip_service = None
            try:
                clip_service = get_clip_embedding_service()
            except Exception as exc:  # pylint: disable=broad-except
                logger.debug("CLIP服务不可用，跳过文本CLIP打分: %s", exc)

            if clip_service is not None and candidates:
                try:
                    query_clip_vectors = clip_service.encode_texts([query_text[:CLIP_TEXT_TRUNCATE]])
                except Exception as exc:  # pylint: disable=broad-except
                    logger.debug("CLIP查询向量生成失败: %s", exc)
                    query_clip_vectors = []

                if query_clip_vectors:
                    query_clip_vec = np.asarray(query_clip_vectors[0], dtype=np.float32)
                    clip_payload: List[Tuple[int, str]] = []
                    for idx, candidate in enumerate(candidates[:CLIP_CANDIDATE_LIMIT]):
                        content = candidate.get('content') or ''
                        trimmed = str(content).strip()
                        if not trimmed:
                            continue
                        clip_payload.append((idx, trimmed[:CLIP_TEXT_TRUNCATE]))

                    if clip_payload:
                        try:
                            clip_texts = [text for _, text in clip_payload]
                            clip_vectors = clip_service.encode_texts(clip_texts)
                        except Exception as exc:  # pylint: disable=broad-except
                            logger.debug("CLIP候选向量生成失败: %s", exc)
                            clip_vectors = []

                        if clip_vectors:
                            doc_matrix = np.asarray(clip_vectors, dtype=np.float32)
                            if doc_matrix.ndim == 1:
                                doc_matrix = doc_matrix.reshape(1, -1)
                            if doc_matrix.size and doc_matrix.shape[1] == query_clip_vec.shape[0]:
                                scores = doc_matrix @ query_clip_vec
                                clip_used_local = True
                                for order, (candidate_idx, _) in enumerate(clip_payload):
                                    candidate = candidates[candidate_idx]
                                    score = float(scores[order])
                                    normalized = clamp_unit((score + 1.0) / 2.0)
                                    candidate['clip_score'] = score
                                    candidate['clip_norm'] = normalized
                                    candidate['clip_rank'] = order + 1
                                    candidate['sources'].add('clip')

            for candidate in candidates:
                emb_norm = candidate.get('embedding_norm') or 0.0
                bm_norm = candidate.get('bm25_norm') or 0.0
                clip_norm = candidate.get('clip_norm') or 0.0
                candidate['pre_score'] = emb_norm + bm_norm + clip_norm

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
                clip_norm = candidate.get('clip_norm')
                if emb_norm is not None:
                    breakdown['dense'] = emb_norm
                    candidate['sources'].add('dense')
                if bm_norm is not None:
                    breakdown['lexical'] = bm_norm
                if rerank_norm is not None:
                    breakdown['reranker'] = rerank_norm
                if clip_norm is not None:
                    breakdown['clip'] = clip_norm

                weights: Dict[str, float] = {}
                if 'dense' in breakdown and embedding_weight > 0:
                    weights['dense'] = embedding_weight
                if 'lexical' in breakdown and bm25_weight > 0:
                    weights['lexical'] = bm25_weight
                if 'reranker' in breakdown and rerank_weight > 0:
                    weights['reranker'] = rerank_weight
                if 'clip' in breakdown and FUSION_CLIP_WEIGHT > 0:
                    weights['clip'] = FUSION_CLIP_WEIGHT

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
            return candidates, bm25_used_local, rerank_used_local, clip_used_local

        if not perfect_exact_matches:
            text_candidates, bm25_used, rerank_used, clip_used = collect_text_candidates()

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
                    'clip_score': candidate.get('clip_score'),
                    'clip_score_normalized': candidate.get('clip_norm'),
                    'clip_rank': candidate.get('clip_rank'),
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
                'clip_score': candidate.get('clip_score'),
                'clip_score_normalized': candidate.get('clip_norm'),
                'clip_rank': candidate.get('clip_rank'),
            }
            result.setdefault('metrics', {})
            result['metrics']['semantic'] = metrics
            return result

        def _candidate_passes(candidate: Dict[str, Any]) -> bool:
            emb_norm = candidate.get('embedding_norm')
            bm_norm = candidate.get('bm25_norm')
            rerank_norm = candidate.get('rerank_norm')
            clip_norm = candidate.get('clip_norm')

            components = [comp for comp in (emb_norm, bm_norm, rerank_norm, clip_norm) if comp is not None]
            if not components:
                return False

            if max(components) < TEXT_MIN_COMPONENT_SCORE:
                return False

            final_score = candidate.get('final_score') or 0.0
            if final_score < TEXT_MIN_FINAL_SCORE:
                return False

            rerank_ok = rerank_norm is not None and rerank_norm >= TEXT_MIN_COMPONENT_SCORE
            clip_ok = clip_norm is not None and clip_norm >= TEXT_MIN_COMPONENT_SCORE
            dense_ok = emb_norm is not None and emb_norm >= TEXT_MIN_COMPONENT_SCORE
            lexical_ok = bm_norm is not None and bm_norm >= TEXT_MIN_COMPONENT_SCORE

            if rerank_ok or clip_ok:
                return True
            if dense_ok and lexical_ok:
                return True
            return False

        def _is_strong_candidate(candidate: Dict[str, Any]) -> bool:
            rerank_norm = candidate.get('rerank_norm') or 0.0
            clip_norm = candidate.get('clip_norm') or 0.0
            emb_norm = candidate.get('embedding_norm') or 0.0
            bm_norm = candidate.get('bm25_norm') or 0.0
            final_score = candidate.get('final_score') or 0.0
            return (
                rerank_norm >= TEXT_STRONG_RERANK_THRESHOLD
                or clip_norm >= TEXT_STRONG_CLIP_THRESHOLD
                or (emb_norm >= TEXT_STRONG_DENSE_THRESHOLD and bm_norm >= TEXT_STRONG_LEXICAL_THRESHOLD)
                or final_score >= TEXT_STRONG_FINAL_THRESHOLD
            )

        def _is_confident_candidate(candidate: Dict[str, Any]) -> bool:
            rerank_norm = candidate.get('rerank_norm') or 0.0
            clip_norm = candidate.get('clip_norm') or 0.0
            emb_norm = candidate.get('embedding_norm') or 0.0
            bm_norm = candidate.get('bm25_norm') or 0.0
            final_score = candidate.get('final_score') or 0.0

            rerank_confident = rerank_norm >= (TEXT_STRONG_RERANK_THRESHOLD * 0.9)
            clip_confident = clip_norm >= (TEXT_STRONG_CLIP_THRESHOLD * 0.9)
            dense_confident = emb_norm >= TEXT_STRONG_DENSE_THRESHOLD
            lexical_confident = bm_norm >= (TEXT_STRONG_LEXICAL_THRESHOLD * 0.9)
            final_confident = final_score >= TEXT_STRONG_FINAL_THRESHOLD

            return (
                rerank_confident
                or clip_confident
                or (dense_confident and lexical_confident)
                or final_confident
            )

        filtered_candidates = [candidate for candidate in text_candidates if _candidate_passes(candidate)]

        desired_limit = max(top_k, 6)
        selected_candidates: List[Dict[str, Any]] = []

        if filtered_candidates:
            top_candidate = filtered_candidates[0]
            if _is_strong_candidate(top_candidate):
                relative_cutoff = max(
                    TEXT_MIN_FINAL_SCORE,
                    (top_candidate.get('final_score') or 0.0) * TEXT_RELATIVE_KEEP_FACTOR,
                )
                confident_candidates = [
                    candidate for candidate in filtered_candidates
                    if (candidate.get('final_score') or 0.0) >= relative_cutoff and _is_confident_candidate(candidate)
                ]
                if not confident_candidates:
                    confident_candidates = [top_candidate]
                selected_candidates = confident_candidates
            else:
                selected_candidates = filtered_candidates[:desired_limit]

        if len(selected_candidates) < desired_limit:
            for candidate in text_candidates:
                if candidate in selected_candidates:
                    continue
                final_score = candidate.get('final_score') or 0.0
                if final_score >= TEXT_MIN_FINAL_SCORE:
                    selected_candidates.append(candidate)
                if len(selected_candidates) >= desired_limit:
                    break

        selected_candidates = [
            candidate
            for candidate in selected_candidates[:desired_limit]
            if (candidate.get('final_score') or 0.0) >= TEXT_MIN_FINAL_SCORE
        ]
        seen_semantic_keys: Set[Tuple] = set()
        for candidate in selected_candidates:
            key = build_chunk_key(candidate.get('meta', {}))
            if key in seen_semantic_keys:
                continue
            rank = len(semantic_results) + 1
            semantic_results.append(serialize_candidate(candidate, rank))
            seen_semantic_keys.add(key)

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
        image_results = deduplicate_results(image_results)
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
                'clip_performed': clip_used,
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
