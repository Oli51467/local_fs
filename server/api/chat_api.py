import asyncio
import json
import logging
import re
import textwrap
from pathlib import Path
from typing import Any, Dict, Generator, List, Optional, Set, Tuple

from fastapi import APIRouter, HTTPException, Response
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
import requests
from requests.exceptions import RequestException, Timeout
import numpy as np
import faiss
from openai import OpenAI

from config.config import ServerConfig
from api.status_api import status_broadcaster
from service.bm25s_service import BM25SService
from service.clip_embedding_service import (
    CLIPEmbeddingService,
    get_clip_embedding_service,
)
from service.embedding_service import EmbeddingService
from service.faiss_service import FaissManager
from service.llm_client import LLMClientError, SiliconFlowClient
from service.reranker_service import RerankerService
from service.sqlite_service import SQLiteManager


logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/chat", tags=["chat"])

faiss_manager: Optional[FaissManager] = None
sqlite_manager: Optional[SQLiteManager] = None
embedding_service: Optional[EmbeddingService] = None
bm25s_service: Optional[BM25SService] = None
reranker_service: Optional[RerankerService] = None
llm_client: Optional[SiliconFlowClient] = None
clip_embedding_service: Optional[CLIPEmbeddingService] = None

MAX_CHUNK_CHARS = 800

DENSE_RECALL_MULTIPLIER = 10
DENSE_RECALL_MIN = 120
DENSE_RECALL_MAX = 400

LEXICAL_RECALL_MULTIPLIER = 5
LEXICAL_RECALL_MIN = 80
LEXICAL_RECALL_MAX = 250

MERGED_CANDIDATE_LIMIT = 500
RERANK_CANDIDATE_LIMIT = 150
CLIP_CANDIDATE_LIMIT = 220

RERANK_FUSION_WEIGHT = 0.45
DENSE_FUSION_WEIGHT = 0.3
LEXICAL_FUSION_WEIGHT = 0.15
CLIP_FUSION_WEIGHT = 0.1

MIN_COMPONENT_SCORE = 0.4
MIN_FINAL_SCORE = 0.45
RERANK_STRONG_THRESHOLD = 0.55
DENSE_STRONG_THRESHOLD = 0.6
LEXICAL_STRONG_THRESHOLD = 0.5
FINAL_STRONG_THRESHOLD = 0.62
RELATIVE_SCORE_KEEP = 0.75
CLIP_STRONG_THRESHOLD = 0.58
CLIP_TEXT_TRUNCATE = 512
REFERENCE_SNIPPET_MAX_CHARS = 320
CHAT_PROGRESS_TOTAL_STEPS = 6
SUMMARY_SEARCH_SCORE_THRESHOLD = 0.7
SUMMARY_SEARCH_CANDIDATE_LIMIT = 20
SUMMARY_SEARCH_MATCH_LIMIT = 3
SUMMARY_VECTOR_TYPE = "summary"
SUMMARY_SEARCH_VECTOR_WEIGHT = 0.6
SUMMARY_SEARCH_LEXICAL_WEIGHT = 0.4


def _schedule_status_broadcast(
    payload: Dict[str, Any], keep_latest: bool = False
) -> None:
    """调度状态广播，兼容同步/异步上下文。"""

    async def _send() -> None:
        try:
            await status_broadcaster.broadcast(payload, keep_latest=keep_latest)
        except Exception:
            logger.debug("广播聊天进度失败", exc_info=True)

    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        loop = None

    if loop and loop.is_running():
        loop.create_task(_send())
        return

    try:
        asyncio.run(_send())
    except RuntimeError:
        new_loop = asyncio.new_event_loop()
        try:
            new_loop.run_until_complete(_send())
        finally:
            new_loop.close()


def _schedule_chat_progress(
    conversation_id: Optional[int],
    assistant_message_id: Optional[int],
    user_message_id: Optional[int],
    client_request_id: Optional[str],
    stage: str,
    message: str,
    step: int,
    status: str = "running",
    total_steps: int = CHAT_PROGRESS_TOTAL_STEPS,
) -> None:
    if client_request_id is None and assistant_message_id is None:
        return

    display_message = message
    if stage == "thinking":
        display_message = ""

    payload = {
        "event": "chat_progress",
        "conversation_id": conversation_id,
        "assistant_message_id": assistant_message_id,
        "user_message_id": user_message_id,
        "client_request_id": client_request_id,
        "stage": stage,
        "message": display_message,
        "step": step,
        "total_steps": total_steps,
        "status": status,
    }
    _schedule_status_broadcast(payload, keep_latest=False)


class RetrievedChunk(BaseModel):
    document_id: int
    filename: str
    file_path: str
    chunk_index: int
    content: str
    score: float
    embedding_score: Optional[float] = None
    embedding_score_normalized: Optional[float] = None
    bm25_score: Optional[float] = None
    bm25_raw_score: Optional[float] = None
    rerank_score: Optional[float] = None
    rerank_score_normalized: Optional[float] = None
    vector_id: Optional[int] = None
    sources: List[str] = Field(default_factory=list)
    score_breakdown: Optional[Dict[str, float]] = None
    score_weights: Optional[Dict[str, float]] = None
    dense_rank: Optional[int] = None
    lexical_rank: Optional[int] = None
    rerank_rank: Optional[int] = None
    clip_score: Optional[float] = None
    clip_score_normalized: Optional[float] = None
    clip_rank: Optional[int] = None


class ChatMessageModel(BaseModel):
    id: int
    conversation_id: int
    role: str
    content: str
    metadata: Optional[Dict[str, Any]] = None
    created_time: str


class ReferenceDocument(BaseModel):
    document_id: Optional[int] = None
    filename: str
    file_path: str
    display_name: str
    absolute_path: Optional[str] = None
    project_relative_path: Optional[str] = None
    score: Optional[float] = None
    chunk_indices: List[int] = Field(default_factory=list)
    reference_id: str = Field(default="")
    snippet: Optional[str] = None
    selected: Optional[bool] = None


class ModelSelection(BaseModel):
    source_id: str = Field(..., description="模型来源 ID")
    model_id: str = Field(..., description="模型标识")
    api_model: str = Field(..., description="调用使用的模型名称")
    api_key: Optional[str] = Field(default=None, description="对应的 API Key")
    provider_name: Optional[str] = Field(default=None, description="模型提供方名称")
    api_key_setting: Optional[str] = Field(
        default=None, description="设置页面中的 API Key 标识"
    )
    api_url: Optional[str] = Field(
        default=None, description="自定义模型接口 URL（适用于本地或第三方兼容端点）"
    )
    requires_api_key: Optional[bool] = Field(
        default=None, description="是否需要提供 API Key"
    )


class ChatRequest(BaseModel):
    question: str = Field(..., min_length=1, description="用户提问内容")
    conversation_id: Optional[int] = Field(default=None, description="已有会话 ID")
    top_k: int = Field(default=5, ge=1, le=50, description="返回的片段数量")
    model: Optional[ModelSelection] = Field(
        default=None, description="指定使用的模型信息"
    )
    client_request_id: Optional[str] = Field(
        default=None, description="客户端生成的请求标识，用于跟踪进度"
    )
    use_summary_search: bool = Field(
        default=False, description="是否优先基于文档主题摘要进行检索"
    )


class ChatStreamRequest(ChatRequest):
    model: ModelSelection


class ChatResponse(BaseModel):
    conversation_id: int
    messages: List[ChatMessageModel]
    assistant_message: ChatMessageModel
    chunks: List[RetrievedChunk]
    references: List[ReferenceDocument] = Field(default_factory=list)


OLLAMA_REQUEST_TIMEOUT = 60


def _ensure_ollama_url(selection: ModelSelection) -> str:
    url = (selection.api_url or "").strip()
    if not url:
        raise LLMClientError("Ollama 接口 URL 未配置")
    return url


def _call_ollama_chat_completion(
    selection: ModelSelection, payload: Dict[str, Any]
) -> Dict[str, Any]:
    url = _ensure_ollama_url(selection)
    request_payload = dict(payload)
    request_payload["stream"] = False
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json",
    }

    try:
        response = requests.post(
            url,
            json=request_payload,
            headers=headers,
            timeout=OLLAMA_REQUEST_TIMEOUT,
        )
    except (Timeout, RequestException) as exc:
        raise LLMClientError(str(exc)) from exc

    body_text = ""
    try:
        body_text = response.text or ""
    except Exception:  # pragma: no cover - defensive
        body_text = ""

    if response.status_code != 200:
        error_payload: Optional[Dict[str, Any]] = None
        try:
            error_payload = response.json()
        except ValueError:
            error_payload = None

        message = None
        if isinstance(error_payload, dict):
            message = error_payload.get("error") or error_payload.get("message")
        if not message:
            message = body_text.strip() or response.reason or "Ollama 调用失败"
        raise LLMClientError(message, status_code=response.status_code, payload=error_payload)

    try:
        data = response.json()
    except ValueError as exc:
        raise LLMClientError("无法解析 Ollama 返回的数据") from exc

    return data


def _stream_ollama_chat(
    selection: ModelSelection, payload: Dict[str, Any]
) -> Generator[Dict[str, Any], None, None]:
    url = _ensure_ollama_url(selection)
    stream_payload = dict(payload)
    stream_payload["stream"] = True
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json",
    }

    try:
        response = requests.post(
            url,
            json=stream_payload,
            headers=headers,
            timeout=OLLAMA_REQUEST_TIMEOUT,
            stream=True,
        )
    except (Timeout, RequestException) as exc:
        raise LLMClientError(str(exc)) from exc

    if response.status_code != 200:
        body_text = ""
        try:
            body_text = response.text or ""
        except Exception:  # pragma: no cover - defensive
            body_text = ""
        error_payload: Optional[Dict[str, Any]] = None
        try:
            error_payload = response.json()
        except ValueError:
            error_payload = None
        message = None
        if isinstance(error_payload, dict):
            message = error_payload.get("error") or error_payload.get("message")
        if not message:
            message = body_text.strip() or response.reason or "Ollama 调用失败"
        raise LLMClientError(message, status_code=response.status_code, payload=error_payload)

    response.encoding = "utf-8"

    try:
        for raw_line in response.iter_lines(decode_unicode=True):
            if raw_line is None:
                continue
            line = raw_line.strip()
            if not line:
                continue
            if line.startswith("data:"):
                line = line[5:].strip()
            if not line or line == "[DONE]":
                continue
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                logger.debug("忽略无法解析的 Ollama 流数据: %s", line)
                continue
            yield event
    finally:
        response.close()


def _prepare_modelscope_request(payload: Dict[str, Any]) -> Tuple[Dict[str, Any], bool]:
    body = dict(payload)
    stream_flag = bool(body.pop("stream", False))
    extra_body = body.pop("extra_body", None)
    kwargs = dict(body)
    if extra_body is not None:
        kwargs["extra_body"] = extra_body
    return kwargs, stream_flag


def _call_modelscope_chat_completion(
    api_key: str, payload: Dict[str, Any]
) -> Dict[str, Any]:
    kwargs, _ = _prepare_modelscope_request(payload)
    kwargs["stream"] = False
    client = OpenAI(api_key=api_key, base_url=MODELSCOPE_BASE_URL)
    try:
        response = client.chat.completions.create(**kwargs)
    except Exception as exc:  # pylint: disable=broad-except
        raise LLMClientError(str(exc)) from exc
    result = response.model_dump()
    choices = result.get("choices") or []
    if choices:
        choice = choices[0]
        message = choice.get("message") or {}
        main_text = (message.get("content") or "").strip()
        reasoning_raw = (
            message.pop("reasoning_content", None)
            or message.pop("reasoning", None)
            or ""
        )
        reasoning_text = ""
        if isinstance(reasoning_raw, list):
            reasoning_text = "".join(str(item) for item in reasoning_raw).strip()
        else:
            reasoning_text = str(reasoning_raw or "").strip()

        if reasoning_text:
            message["content"] = f"<think>{reasoning_text}</think>{main_text}"
        else:
            message["content"] = main_text
        choice["message"] = message
        choices[0] = choice
        result["choices"] = choices
    return result


def _stream_modelscope_chat(
    api_key: str, payload: Dict[str, Any]
) -> Generator[Dict[str, Any], None, None]:
    kwargs, stream_flag = _prepare_modelscope_request(payload)
    kwargs["stream"] = stream_flag or True
    client = OpenAI(api_key=api_key, base_url=MODELSCOPE_BASE_URL)
    in_thinking = False
    try:
        stream = client.chat.completions.create(**kwargs)
        for chunk in stream:
            if chunk is None:
                continue
            data = chunk.model_dump()
            choices = data.get("choices") or []
            if choices:
                choice = choices[0]
                delta = choice.get("delta") or {}
                message = choice.get("message") or {}
                reasoning = delta.pop("reasoning_content", None)
                if not reasoning:
                    reasoning = message.pop("reasoning_content", None)
                if not reasoning:
                    reasoning = message.pop("reasoning", None)
                if isinstance(reasoning, list):
                    reasoning = "".join(str(item) for item in reasoning)
                reasoning = "" if reasoning is None else str(reasoning)
                answer_piece = delta.get("content") or ""
                final_piece = ""

                if reasoning:
                    if not in_thinking:
                        final_piece += "<think>"
                        in_thinking = True
                    final_piece += reasoning

                finish_reason = choice.get("finish_reason")
                if answer_piece:
                    if in_thinking:
                        final_piece += "</think>"
                        in_thinking = False
                    final_piece += answer_piece
                elif in_thinking and not reasoning and finish_reason:
                    final_piece += "</think>"
                    in_thinking = False

                delta["content"] = final_piece
                choice["delta"] = delta
                data["choices"] = [choice]
            yield data
        if in_thinking:
            yield {
                "choices": [
                    {
                        "delta": {"content": "</think>"},
                        "finish_reason": "stop",
                    }
                ]
            }
    except Exception as exc:  # pylint: disable=broad-except
        raise LLMClientError(str(exc)) from exc


class ConversationSummary(BaseModel):
    id: int
    title: str
    created_time: str
    updated_time: str
    last_message: Optional[str] = None
    last_role: Optional[str] = None
    message_count: int


class ConversationDetail(BaseModel):
    conversation: ConversationSummary
    messages: List[ChatMessageModel]


def init_chat_api(
    faiss_mgr: FaissManager,
    sqlite_mgr: SQLiteManager,
    embedding_srv: EmbeddingService,
    bm25s_srv: Optional[BM25SService] = None,
    reranker_srv: Optional[RerankerService] = None,
    llm_client_instance: Optional[SiliconFlowClient] = None,
) -> None:
    global faiss_manager, sqlite_manager, embedding_service, bm25s_service, reranker_service, llm_client
    faiss_manager = faiss_mgr
    sqlite_manager = sqlite_mgr
    embedding_service = embedding_srv
    bm25s_service = bm25s_srv
    reranker_service = reranker_srv
    llm_client = llm_client_instance


def _ensure_dependencies(require_llm: bool = False) -> None:
    if not all([faiss_manager, sqlite_manager, embedding_service]):
        raise HTTPException(status_code=503, detail="Chat service is not ready")
    if require_llm and llm_client is None:
        raise HTTPException(status_code=503, detail="LLM service is not available")


def _ensure_clip_service() -> Optional[CLIPEmbeddingService]:
    global clip_embedding_service
    if clip_embedding_service is not None:
        return clip_embedding_service
    try:
        clip_embedding_service = get_clip_embedding_service()
    except Exception as exc:  # pragma: no cover - optional dependency
        logger.warning("CLIP embedding service unavailable: %s", exc)
        clip_embedding_service = None
    return clip_embedding_service


def _generate_conversation_title(question: str) -> str:
    normalized = " ".join(question.strip().split())
    if not normalized:
        return "新对话"
    if len(normalized) > 60:
        return normalized[:57] + "..."
    return normalized


def _retrieve_chunks_from_document_summaries(
    question: str,
) -> Optional[Tuple[List[RetrievedChunk], Dict[str, Any]]]:
    assert (
        embedding_service is not None
        and faiss_manager is not None
        and sqlite_manager is not None
    )

    normalized_question = question.strip()
    if not normalized_question:
        return None

    summary_entries: List[Tuple[int, Dict[str, Any]]] = []
    metadata_source = getattr(faiss_manager, "metadata", []) or []
    for idx, metadata in enumerate(metadata_source):
        if not isinstance(metadata, dict):
            continue
        vector_type = metadata.get("vector_type") or metadata.get("vectorType")
        if vector_type != SUMMARY_VECTOR_TYPE:
            continue
        summary_entries.append((idx, metadata))

    if not summary_entries:
        return None

    try:
        query_vector = embedding_service.encode_text(normalized_question)
    except Exception as exc:  # pragma: no cover - defensive logging
        logger.warning("基于摘要检索时生成查询向量失败: %s", exc)
        return None

    query_array = np.asarray(query_vector, dtype=np.float32)
    if query_array.ndim == 2:
        query_array = query_array.reshape(-1)
    if query_array.ndim != 1 or query_array.size == 0:
        return None
    query_matrix = query_array.reshape(1, -1)
    try:
        faiss.normalize_L2(query_matrix)
    except Exception as exc:  # pragma: no cover - defensive logging
        logger.debug("基于摘要检索时归一化查询向量失败: %s", exc)
        return None
    query_vec = query_matrix[0]

    summary_vectors: List[np.ndarray] = []
    summary_metadata: List[Dict[str, Any]] = []
    summary_indices: List[int] = []

    for idx, metadata in summary_entries:
        try:
            vector = faiss_manager.index.reconstruct(idx)
        except Exception as exc:  # pragma: no cover - defensive logging
            logger.debug(
                "基于摘要检索时重建摘要向量失败 (vector_id=%s): %s",
                metadata.get("vector_id"),
                exc,
            )
            continue
        if vector is None:
            continue
        vector_array = np.asarray(vector, dtype=np.float32)
        if vector_array.ndim == 2:
            vector_array = vector_array.reshape(-1)
        if vector_array.ndim != 1 or vector_array.size != query_vec.size:
            continue
        summary_vectors.append(vector_array)
        summary_metadata.append(metadata)
        summary_indices.append(idx)

    if not summary_vectors:
        return None

    summary_matrix = np.vstack(summary_vectors)
    try:
        faiss.normalize_L2(summary_matrix)
    except Exception:  # pragma: no cover - defensive
        pass

    scores = summary_matrix @ query_vec
    if scores.size == 0:
        return None

    ranked_idx = np.argsort(scores)[::-1][:SUMMARY_SEARCH_CANDIDATE_LIMIT]
    if ranked_idx.size == 0:
        return None

    summary_details_cache: Dict[int, Optional[Dict[str, Any]]] = {}
    candidates: List[Dict[str, Any]] = []
    seen_documents: Set[int] = set()

    for order in ranked_idx:
        score_raw = float(scores[order])
        metadata = summary_metadata[order]
        vector_index = summary_indices[order]
        doc_id_raw = metadata.get("document_id")
        try:
            document_id = int(doc_id_raw)
        except (TypeError, ValueError):
            continue
        if document_id in seen_documents:
            continue
        seen_documents.add(document_id)

        summary_record: Optional[Dict[str, Any]]
        if document_id in summary_details_cache:
            summary_record = summary_details_cache[document_id]
        else:
            try:
                summary_record = sqlite_manager.get_document_summary(document_id)
            except Exception as exc:  # pragma: no cover - defensive logging
                logger.debug(
                    "基于摘要检索时获取摘要记录失败 (document_id=%s): %s", document_id, exc
                )
                summary_record = None
            summary_details_cache[document_id] = summary_record

        summary_text = ""
        if summary_record and isinstance(summary_record.get("summary_text"), str):
            summary_text = summary_record.get("summary_text") or ""
        elif isinstance(metadata.get("summary_preview"), str):
            summary_text = metadata.get("summary_preview") or ""

        file_path = (metadata.get("file_path") or "").strip()
        filename = (metadata.get("filename") or "").strip()
        if not filename and file_path:
            filename = Path(file_path).name

        score_clamped = max(0.0, min(1.0, score_raw))
        candidates.append(
            {
                "document_id": document_id,
                "vector_score_raw": score_raw,
                "vector_score_norm": score_clamped,
                "metadata": metadata,
                "vector_index": vector_index,
                "summary_text": summary_text or "",
                "file_path": file_path,
                "filename": filename,
            }
        )

    if not candidates:
        return None

    bm25_available = (
        bm25s_service is not None and bm25s_service.is_available()
    )
    lexical_scores: List[float] = [0.0 for _ in candidates]
    if bm25_available:
        try:
            documents = [candidate["summary_text"] or "" for candidate in candidates]
            lexical_scores = bm25s_service.score_documents(
                normalized_question, documents
            )
        except Exception as exc:  # pragma: no cover - defensive logging
            logger.debug("基于摘要检索时计算BM25分数失败: %s", exc)
            lexical_scores = [0.0 for _ in candidates]

    vector_weight = SUMMARY_SEARCH_VECTOR_WEIGHT
    lexical_weight = SUMMARY_SEARCH_LEXICAL_WEIGHT if bm25_available else 0.0
    weight_sum = vector_weight + lexical_weight
    if weight_sum <= 0.0:
        weight_sum = 1.0

    for idx, candidate in enumerate(candidates):
        lexical_raw = float(lexical_scores[idx]) if idx < len(lexical_scores) else 0.0
        lexical_norm = 0.0
        if lexical_raw > 0.0:
            lexical_norm = float(lexical_raw / (lexical_raw + 1.0))
        candidate["lexical_score_raw"] = lexical_raw if bm25_available else None
        candidate["lexical_score_norm"] = lexical_norm if bm25_available else None
        combined = (
            candidate["vector_score_norm"] * vector_weight
            + (lexical_norm * lexical_weight if bm25_available else 0.0)
        ) / weight_sum
        candidate["final_score"] = combined

    candidates.sort(
        key=lambda item: (
            item.get("final_score", 0.0),
            item.get("vector_score_norm", 0.0),
            item.get("lexical_score_norm") or 0.0,
        ),
        reverse=True,
    )

    matched_documents: List[Dict[str, Any]] = []
    retrieved_chunks: List[RetrievedChunk] = []
    selected = [
        candidate
        for candidate in candidates
        if candidate.get("final_score", 0.0) >= SUMMARY_SEARCH_SCORE_THRESHOLD
    ][:SUMMARY_SEARCH_MATCH_LIMIT]

    if not selected:
        return None

    for rank, candidate in enumerate(selected, start=1):
        document_id = candidate["document_id"]
        try:
            doc_chunks = sqlite_manager.get_document_chunks(document_id)
        except Exception as exc:  # pragma: no cover - defensive logging
            logger.debug(
                "基于摘要检索时获取文档块失败 (document_id=%s): %s", document_id, exc
            )
            continue
        if not doc_chunks:
            continue

        match_info = {
            "document_id": document_id,
            "score": candidate["final_score"],
            "vector_score": candidate["vector_score_norm"],
            "vector_raw_score": candidate["vector_score_raw"],
            "lexical_score": candidate.get("lexical_score_norm"),
            "lexical_raw_score": candidate.get("lexical_score_raw"),
            "vector_id": candidate["metadata"].get("vector_id"),
            "file_path": candidate["file_path"],
            "filename": candidate["filename"],
            "vector_index": candidate["vector_index"],
            "summary_preview": candidate["metadata"].get("summary_preview"),
            "summary_length": candidate["metadata"].get("summary_length"),
            "summary_model_source": candidate["metadata"].get("summary_model_source"),
            "summary_model_id": candidate["metadata"].get("summary_model_id"),
            "summary_model_name": candidate["metadata"].get("summary_model_name"),
            "summary_model_provider": candidate["metadata"].get("summary_model_provider"),
            "summary_text": candidate.get("summary_text") or "",
            "rank": rank,
        }
        matched_documents.append(match_info)

        summary_text = match_info.get("summary_text") or ""
        if summary_text.strip():
            summary_chunk = RetrievedChunk(
                document_id=document_id,
                filename=candidate["filename"] or "",
                file_path=candidate["file_path"] or "",
                chunk_index=-1,
                content=summary_text,
                score=float(candidate["final_score"]),
                embedding_score=candidate["vector_score_raw"],
                embedding_score_normalized=candidate["vector_score_norm"],
                bm25_score=(
                    candidate.get("lexical_score_norm") if bm25_available else None
                ),
                bm25_raw_score=(
                    candidate.get("lexical_score_raw") if bm25_available else None
                ),
                rerank_score=None,
                rerank_score_normalized=None,
                vector_id=candidate["metadata"].get("vector_id"),
                sources=["summary"],
                score_breakdown={
                    "summary_vector": candidate["vector_score_norm"],
                    **(
                        {"summary_lexical": candidate["lexical_score_norm"]}
                        if bm25_available
                        and candidate.get("lexical_score_norm") is not None
                        else {}
                    ),
                },
                score_weights={
                    "summary_vector": vector_weight / weight_sum,
                    **(
                        {"summary_lexical": lexical_weight / weight_sum}
                        if bm25_available and lexical_weight > 0
                        else {}
                    ),
                },
                dense_rank=None,
                lexical_rank=None,
                rerank_rank=None,
                clip_score=None,
                clip_score_normalized=None,
                clip_rank=None,
            )
            retrieved_chunks.append(summary_chunk)

        for chunk in doc_chunks:
            chunk_filename = chunk.get("filename") or candidate["filename"]
            chunk_path = chunk.get("file_path") or candidate["file_path"]
            try:
                chunk_index = int(chunk.get("chunk_index") or 0)
            except (TypeError, ValueError):
                chunk_index = 0
            score_breakdown = {
                "summary_vector": candidate["vector_score_norm"],
            }
            if bm25_available and candidate.get("lexical_score_norm") is not None:
                score_breakdown["summary_lexical"] = candidate["lexical_score_norm"]

            score_weights = {
                "summary_vector": vector_weight / weight_sum,
            }
            if bm25_available and lexical_weight > 0:
                score_weights["summary_lexical"] = lexical_weight / weight_sum

            retrieved_chunks.append(
                RetrievedChunk(
                    document_id=document_id,
                    filename=chunk_filename or "",
                    file_path=chunk_path or "",
                    chunk_index=chunk_index,
                    content=chunk.get("content") or "",
                    score=float(candidate["final_score"]),
                    embedding_score=candidate["vector_score_raw"],
                    embedding_score_normalized=candidate["vector_score_norm"],
                    bm25_score=(
                        candidate.get("lexical_score_norm")
                        if bm25_available
                        else None
                    ),
                    bm25_raw_score=(
                        candidate.get("lexical_score_raw")
                        if bm25_available
                        else None
                    ),
                    rerank_score=None,
                    rerank_score_normalized=None,
                    vector_id=chunk.get("vector_id"),
                    sources=["summary"],
                    score_breakdown=score_breakdown,
                    score_weights=score_weights,
                    dense_rank=None,
                    lexical_rank=None,
                    rerank_rank=None,
                    clip_score=None,
                    clip_score_normalized=None,
                    clip_rank=None,
                )
            )

    if not matched_documents or not retrieved_chunks:
        return None

    matched_vector_indices = [
        match.get("vector_index")
        for match in matched_documents
        if isinstance(match.get("vector_index"), int)
    ]
    retrieval_context = {
        "mode": "summary",
        "summary_matches": matched_documents,
        "summary_threshold": SUMMARY_SEARCH_SCORE_THRESHOLD,
        "summary_vector_indices": matched_vector_indices,
        "summary_vector_weight": vector_weight,
        "summary_lexical_weight": lexical_weight,
        "summary_search_applied": True,
        "summary_candidate_total": len(candidates),
    }
    return retrieved_chunks, retrieval_context


def _expand_with_adjacent_chunks(chunks: List[RetrievedChunk]) -> List[RetrievedChunk]:
    """补充位于检索片段之间的相邻上下文块。"""
    if not chunks or sqlite_manager is None:
        return chunks

    valid_entries = [
        chunk
        for chunk in chunks
        if chunk.document_id is not None
        and chunk.document_id >= 0
        and isinstance(chunk.chunk_index, int)
        and chunk.chunk_index >= 0
    ]
    if len(valid_entries) < 2:
        return chunks

    seen_keys: Set[Tuple[int, int]] = {
        (int(chunk.document_id), int(chunk.chunk_index)) for chunk in valid_entries
    }
    doc_groups: Dict[int, List[RetrievedChunk]] = {}
    for chunk in valid_entries:
        doc_groups.setdefault(int(chunk.document_id), []).append(chunk)

    additional_chunks: List[RetrievedChunk] = []

    for document_id, doc_chunks in doc_groups.items():
        ordered = sorted(doc_chunks, key=lambda item: int(item.chunk_index or 0))
        for left, right in zip(ordered, ordered[1:]):
            left_index = int(left.chunk_index or 0)
            right_index = int(right.chunk_index or 0)
            if abs(right_index - left_index) != 2:
                continue

            target_index = min(left_index, right_index) + 1
            key = (document_id, target_index)
            if key in seen_keys:
                continue

            try:
                chunk_record = sqlite_manager.get_chunk_by_document_and_index(
                    document_id, target_index
                )
            except Exception:  # pragma: no cover - defensive logging
                chunk_record = None

            if not chunk_record:
                continue

            raw_content = chunk_record.get("content") or ""
            if isinstance(raw_content, bytes):
                raw_content = raw_content.decode("utf-8", "ignore")
            content = raw_content.strip()
            if not content:
                continue

            score_candidates = [
                value
                for value in (left.score, right.score)
                if isinstance(value, (int, float))
            ]
            base_score = (
                sum(score_candidates) / len(score_candidates)
                if score_candidates
                else 0.0
            )
            adjusted_score = max(0.0, float(base_score) * 0.95)

            combined_sources: Set[str] = set(left.sources) | set(right.sources)
            combined_sources.add("adjacent_fill")

            additional_chunks.append(
                RetrievedChunk(
                    document_id=document_id,
                    filename=(
                        chunk_record.get("filename")
                        or left.filename
                        or right.filename
                        or ""
                    ),
                    file_path=(
                        chunk_record.get("file_path")
                        or left.file_path
                        or right.file_path
                        or ""
                    ),
                    chunk_index=target_index,
                    content=content,
                    score=adjusted_score,
                    embedding_score=None,
                    embedding_score_normalized=None,
                    bm25_score=None,
                    bm25_raw_score=None,
                    rerank_score=None,
                    rerank_score_normalized=None,
                    vector_id=chunk_record.get("vector_id"),
                    sources=sorted(combined_sources),
                    score_breakdown={"adjacent_fill": 1.0},
                    score_weights={"adjacent_fill": 1.0},
                    dense_rank=None,
                    lexical_rank=None,
                    rerank_rank=None,
                    clip_score=None,
                    clip_score_normalized=None,
                    clip_rank=None,
                )
            )
            seen_keys.add(key)

    if not additional_chunks:
        return chunks

    # 保留原有排序，将补充块附加在尾部，确保主检索结果优先展示。
    return chunks + additional_chunks


def _retrieve_chunks(question: str, top_k: int) -> List[RetrievedChunk]:
    assert (
        embedding_service is not None
        and faiss_manager is not None
        and sqlite_manager is not None
    )

    bm25_service = (
        bm25s_service if bm25s_service and bm25s_service.is_available() else None
    )
    reranker = reranker_service

    def _normalize_embedding(raw: Optional[float]) -> Optional[float]:
        if raw is None:
            return None
        try:
            normalized = (float(raw) + 1.0) / 2.0
        except (TypeError, ValueError):
            return None
        return max(0.0, min(1.0, normalized))

    def _normalize_bm25(raw: Optional[float]) -> Optional[float]:
        if raw is None:
            return None
        try:
            raw_val = float(raw)
        except (TypeError, ValueError):
            return None
        if raw_val <= 0.0:
            return 0.0
        return float(raw_val / (raw_val + 1.0))

    candidate_map: Dict[int, Dict[str, Any]] = {}
    chunk_cache: Dict[int, Optional[Dict[str, Any]]] = {}

    def _fetch_chunk(
        vector_id: int, fallback: Optional[Dict[str, Any]]
    ) -> Optional[Dict[str, Any]]:
        if vector_id in chunk_cache:
            return chunk_cache[vector_id]
        try:
            record = sqlite_manager.get_chunk_by_vector_id(int(vector_id))
        except Exception as exc:  # pragma: no cover - defensive logging
            logger.warning("Failed to fetch chunk by vector id %s: %s", vector_id, exc)
            record = None
        if not record and fallback:
            # Fallback to metadata when sqlite missing (legacy indices)
            fallback_content = (
                fallback.get("chunk_text")
                or fallback.get("text")
                or fallback.get("content")
                or ""
            )
            if fallback_content:
                record = {
                    "document_id": fallback.get("document_id"),
                    "filename": fallback.get("filename") or "",
                    "file_path": fallback.get("file_path")
                    or fallback.get("path")
                    or "",
                    "chunk_index": fallback.get("chunk_index", 0),
                    "content": fallback_content,
                }
        chunk_cache[vector_id] = record
        return record

    def _get_candidate(
        vector_id: int, source_payload: Optional[Dict[str, Any]]
    ) -> Optional[Dict[str, Any]]:
        if vector_id is None or vector_id < 0:
            return None
        if vector_id in candidate_map:
            return candidate_map[vector_id]

        chunk_record = _fetch_chunk(vector_id, source_payload)
        if not chunk_record:
            return None

        raw_content = chunk_record.get("content")
        if raw_content is None:
            return None
        if isinstance(raw_content, bytes):
            raw_content = raw_content.decode("utf-8", "ignore")
        if not isinstance(raw_content, str):
            raw_content = str(raw_content)

        if not raw_content.strip():
            return None

        candidate = {
            "vector_id": int(vector_id),
            "document_id": chunk_record.get("document_id"),
            "filename": chunk_record.get("filename")
            or (source_payload or {}).get("filename")
            or "",
            "file_path": chunk_record.get("file_path")
            or (source_payload or {}).get("file_path")
            or "",
            "chunk_index": chunk_record.get("chunk_index", 0),
            "content": raw_content,
            "embedding_score": None,
            "embedding_norm": None,
            "bm25_raw": None,
            "bm25_norm": None,
            "rerank_score": None,
            "rerank_norm": None,
            "dense_rank": None,
            "lexical_rank": None,
            "clip_score": None,
            "clip_norm": None,
            "clip_rank": None,
            "sources": set(),  # type: Set[str]
        }
        candidate_map[vector_id] = candidate
        return candidate

    query_vector = embedding_service.encode_text(question)
    dense_limit = min(
        max(top_k * DENSE_RECALL_MULTIPLIER, DENSE_RECALL_MIN), DENSE_RECALL_MAX
    )

    try:
        dense_results = faiss_manager.search_vectors([query_vector], k=dense_limit)
    except Exception as exc:  # pragma: no cover - defensive logging
        logger.error("Failed to search vectors: %s", exc)
        dense_results = []

    if dense_results:
        for idx, item in enumerate(dense_results[0][:dense_limit]):
            vector_id = item.get("vector_id")
            candidate = _get_candidate(
                int(vector_id) if vector_id is not None else -1, item
            )
            if not candidate:
                continue
            candidate["sources"].add("dense")
            candidate["dense_rank"] = (
                idx + 1
                if candidate.get("dense_rank") is None
                else min(candidate["dense_rank"], idx + 1)
            )
            score = item.get("score")
            if score is not None:
                embedding_score = float(score)
                candidate["embedding_score"] = embedding_score
                candidate["embedding_norm"] = _normalize_embedding(embedding_score)

    lexical_limit = min(
        max(top_k * LEXICAL_RECALL_MULTIPLIER, LEXICAL_RECALL_MIN), LEXICAL_RECALL_MAX
    )
    if bm25_service and lexical_limit > 0:
        try:
            lexical_results = bm25_service.retrieve(question, top_k=lexical_limit)
        except Exception as exc:  # pragma: no cover - defensive logging
            logger.warning("BM25 retrieval failed: %s", exc)
            lexical_results = []

        for item in lexical_results:
            doc_id = item.get("doc_id")
            try:
                doc_index = int(doc_id)
            except (TypeError, ValueError):
                doc_index = None

            meta: Optional[Dict[str, Any]] = None
            vector_id_meta: Optional[int] = None
            if doc_index is not None and 0 <= doc_index < len(faiss_manager.metadata):
                meta = faiss_manager.metadata[doc_index]
                vector_id_meta = meta.get("vector_id")
            if vector_id_meta is None:
                # 兼容旧数据，尝试使用doc_index作为vector id
                vector_id_meta = doc_index

            if vector_id_meta is None:
                continue

            candidate = _get_candidate(int(vector_id_meta), meta)
            if not candidate:
                continue

            candidate["sources"].add("lexical")
            rank = item.get("rank")
            if isinstance(rank, int):
                candidate["lexical_rank"] = (
                    rank
                    if candidate.get("lexical_rank") is None
                    else min(candidate["lexical_rank"], rank)
                )
            bm25_raw = item.get("score")
            if bm25_raw is not None:
                raw_val = float(bm25_raw)
                candidate["bm25_raw"] = raw_val
                candidate["bm25_norm"] = _normalize_bm25(raw_val)

    candidates: List[Dict[str, Any]] = list(candidate_map.values())
    if not candidates:
        return []

    clip_service = _ensure_clip_service()
    if clip_service is not None:
        try:
            query_clip_vectors = clip_service.encode_texts([question])
        except Exception as exc:  # pragma: no cover - optional path
            logger.debug("Failed to encode query with CLIP: %s", exc)
            query_clip_vectors = []
        if query_clip_vectors:
            query_clip_vec = np.array(query_clip_vectors[0], dtype=np.float32)
            clip_payload: List[Tuple[int, str]] = []
            for idx, candidate in enumerate(candidates[:CLIP_CANDIDATE_LIMIT]):
                content = candidate.get("content") or ""
                trimmed = str(content).strip()
                if not trimmed:
                    continue
                clip_payload.append((idx, trimmed[:CLIP_TEXT_TRUNCATE]))
            if clip_payload:
                try:
                    clip_texts = [text for _, text in clip_payload]
                    clip_vectors = clip_service.encode_texts(clip_texts)
                except Exception as exc:  # pragma: no cover - optional path
                    logger.debug(
                        "Failed to encode candidate passages with CLIP: %s", exc
                    )
                    clip_vectors = []
                if clip_vectors:
                    doc_matrix = np.array(clip_vectors, dtype=np.float32)
                    if doc_matrix.ndim == 1:
                        doc_matrix = doc_matrix.reshape(1, -1)
                    if (
                        doc_matrix.size
                        and doc_matrix.shape[1] == query_clip_vec.shape[0]
                    ):
                        scores = doc_matrix @ query_clip_vec
                        for order, (candidate_idx, _) in enumerate(clip_payload):
                            candidate = candidates[candidate_idx]
                            score = float(scores[order])
                            normalized = max(0.0, min(1.0, (score + 1.0) / 2.0))
                            candidate["clip_score"] = score
                            candidate["clip_norm"] = normalized
                            candidate["clip_rank"] = order + 1
                            candidate["sources"].add("clip")
    for candidate in candidates:
        emb_norm = candidate.get("embedding_norm")
        bm_norm = candidate.get("bm25_norm")
        clip_norm = candidate.get("clip_norm")
        candidate["pre_score"] = (
            (emb_norm or 0.0) + (bm_norm or 0.0) + (clip_norm or 0.0)
        )

    candidates.sort(
        key=lambda item: (
            item.get("pre_score", 0.0),
            item.get("embedding_norm", 0.0),
            item.get("bm25_norm", 0.0),
        ),
        reverse=True,
    )

    if len(candidates) > MERGED_CANDIDATE_LIMIT:
        candidates = candidates[:MERGED_CANDIDATE_LIMIT]

    rerank_input = [candidate for candidate in candidates if candidate.get("content")]
    rerank_limit = min(max(top_k * 6, 60), RERANK_CANDIDATE_LIMIT)
    rerank_limit = min(rerank_limit, len(rerank_input))

    if reranker is not None and rerank_limit > 0:
        try:
            rerank_scores = reranker.rerank_results(
                question,
                [candidate["content"] for candidate in rerank_input[:rerank_limit]],
                normalize=True,
            )
        except Exception as exc:  # pragma: no cover - defensive logging
            logger.warning("Reranker scoring failed: %s", exc)
            rerank_scores = []

        for idx, (candidate, score) in enumerate(
            zip(rerank_input[:rerank_limit], rerank_scores)
        ):
            try:
                normalized_score = max(0.0, min(1.0, float(score)))
            except (TypeError, ValueError):
                normalized_score = 0.0
            candidate["sources"].add("reranker")
            candidate["rerank_score"] = float(score)
            candidate["rerank_norm"] = normalized_score
            candidate["rerank_rank"] = idx + 1

    ranked: List[RetrievedChunk] = []
    for candidate in candidates:
        emb_norm = candidate.get("embedding_norm")
        bm_norm = candidate.get("bm25_norm")
        rr_norm = candidate.get("rerank_norm")
        clip_norm = candidate.get("clip_norm")

        weight_rerank = RERANK_FUSION_WEIGHT if rr_norm is not None else 0.0
        weight_dense = DENSE_FUSION_WEIGHT if emb_norm is not None else 0.0
        weight_lex = LEXICAL_FUSION_WEIGHT if bm_norm is not None else 0.0
        weight_clip = CLIP_FUSION_WEIGHT if clip_norm is not None else 0.0

        weight_sum = weight_rerank + weight_dense + weight_lex + weight_clip
        if weight_sum <= 0.0:
            fallback_components = [
                comp
                for comp in (rr_norm, emb_norm, bm_norm, clip_norm)
                if comp is not None
            ]
            final_score = max(fallback_components) if fallback_components else 0.0
        else:
            final_score = (
                (rr_norm or 0.0) * weight_rerank
                + (emb_norm or 0.0) * weight_dense
                + (bm_norm or 0.0) * weight_lex
                + (clip_norm or 0.0) * weight_clip
            ) / weight_sum

        candidate["final_score"] = final_score

        score_breakdown = {}
        if rr_norm is not None:
            score_breakdown["reranker"] = rr_norm
        if emb_norm is not None:
            score_breakdown["dense"] = emb_norm
        if bm_norm is not None:
            score_breakdown["lexical"] = bm_norm
        if clip_norm is not None:
            score_breakdown["clip"] = clip_norm

        score_weights = {}
        if weight_sum > 0:
            if weight_rerank > 0:
                score_weights["reranker"] = weight_rerank / weight_sum
            if weight_dense > 0:
                score_weights["dense"] = weight_dense / weight_sum
            if weight_lex > 0:
                score_weights["lexical"] = weight_lex / weight_sum
            if weight_clip > 0:
                score_weights["clip"] = weight_clip / weight_sum

        ranked.append(
            RetrievedChunk(
                document_id=(
                    int(candidate.get("document_id"))
                    if candidate.get("document_id") is not None
                    else -1
                ),
                filename=candidate.get("filename") or "",
                file_path=candidate.get("file_path") or "",
                chunk_index=int(candidate.get("chunk_index") or 0),
                content=candidate.get("content") or "",
                score=float(final_score),
                embedding_score=candidate.get("embedding_score"),
                embedding_score_normalized=emb_norm,
                bm25_score=bm_norm,
                bm25_raw_score=candidate.get("bm25_raw"),
                rerank_score=candidate.get("rerank_score"),
                rerank_score_normalized=rr_norm,
                vector_id=candidate.get("vector_id"),
                sources=sorted(candidate.get("sources", [])),
                score_breakdown=score_breakdown or None,
                score_weights=score_weights or None,
                dense_rank=candidate.get("dense_rank"),
                lexical_rank=candidate.get("lexical_rank"),
                rerank_rank=candidate.get("rerank_rank"),
                clip_score=candidate.get("clip_score"),
                clip_score_normalized=clip_norm,
                clip_rank=candidate.get("clip_rank"),
            )
        )

    ranked.sort(
        key=lambda chunk: (
            chunk.score,
            chunk.rerank_score_normalized or 0.0,
            chunk.embedding_score_normalized or 0.0,
            chunk.bm25_score or 0.0,
            chunk.clip_score_normalized or 0.0,
        ),
        reverse=True,
    )

    def _passes_threshold(chunk: RetrievedChunk) -> bool:
        components = [
            chunk.embedding_score_normalized,
            chunk.bm25_score,
            chunk.rerank_score_normalized,
            chunk.clip_score_normalized,
        ]
        scored_components = [comp for comp in components if comp is not None]
        if not scored_components:
            return False
        if max(scored_components) < MIN_COMPONENT_SCORE:
            return False

        rerank_ok = (
            chunk.rerank_score_normalized is not None
            and chunk.rerank_score_normalized >= MIN_COMPONENT_SCORE
        )
        dense_ok = (
            chunk.embedding_score_normalized is not None
            and chunk.embedding_score_normalized >= MIN_COMPONENT_SCORE
        )
        lexical_ok = (
            chunk.bm25_score is not None and chunk.bm25_score >= MIN_COMPONENT_SCORE
        )
        clip_ok = (
            chunk.clip_score_normalized is not None
            and chunk.clip_score_normalized >= MIN_COMPONENT_SCORE
        )

        if rerank_ok or clip_ok:
            primary_signal = True
        elif dense_ok and lexical_ok:
            primary_signal = True
        elif chunk.score >= MIN_FINAL_SCORE + 0.15:
            primary_signal = True
        else:
            return False

        return primary_signal and chunk.score >= MIN_FINAL_SCORE

    filtered = [chunk for chunk in ranked if _passes_threshold(chunk)]
    if not filtered:
        return []

    top_chunk = filtered[0]
    top_rerank = top_chunk.rerank_score_normalized or 0.0
    top_dense = top_chunk.embedding_score_normalized or 0.0
    top_lexical = top_chunk.bm25_score or 0.0
    top_clip = top_chunk.clip_score_normalized or 0.0

    strong_top = (
        top_rerank >= RERANK_STRONG_THRESHOLD
        or top_clip >= CLIP_STRONG_THRESHOLD
        or (
            top_dense >= DENSE_STRONG_THRESHOLD
            and top_lexical >= LEXICAL_STRONG_THRESHOLD
        )
        or top_chunk.score >= FINAL_STRONG_THRESHOLD
    )

    if not strong_top:
        return []

    relative_cutoff = max(MIN_FINAL_SCORE, top_chunk.score * RELATIVE_SCORE_KEEP)
    confident_chunks: List[RetrievedChunk] = []
    for chunk in filtered:
        if chunk.score < relative_cutoff:
            continue

        rerank_confident = (chunk.rerank_score_normalized or 0.0) >= (
            RERANK_STRONG_THRESHOLD * 0.9
        )
        clip_confident = (chunk.clip_score_normalized or 0.0) >= (
            CLIP_STRONG_THRESHOLD * 0.9
        )
        dense_lexical_confident = (
            chunk.embedding_score_normalized or 0.0
        ) >= DENSE_STRONG_THRESHOLD and (chunk.bm25_score or 0.0) >= (
            LEXICAL_STRONG_THRESHOLD * 0.9
        )
        final_confident = chunk.score >= FINAL_STRONG_THRESHOLD

        if (
            rerank_confident
            or clip_confident
            or dense_lexical_confident
            or final_confident
        ):
            confident_chunks.append(chunk)

    if not confident_chunks:
        confident_chunks = [top_chunk]

    final_chunks = confident_chunks[:top_k]
    final_chunks = _expand_with_adjacent_chunks(final_chunks)
    return final_chunks


def _build_references_from_chunks(
    chunks: List[RetrievedChunk],
) -> List[ReferenceDocument]:
    reference_map: Dict[str, Dict[str, Any]] = {}

    for chunk in chunks:
        raw_path = (chunk.file_path or "").strip()
        normalized_path = raw_path.replace("\\", "/") if raw_path else ""
        file_path = normalized_path
        filename = (
            chunk.filename
            or (Path(normalized_path).name if normalized_path else "")
            or "未知文件"
        )
        key = file_path or filename

        document_id = (
            chunk.document_id
            if chunk.document_id is not None and chunk.document_id >= 0
            else None
        )

        absolute_path: Optional[str] = None
        project_relative: Optional[str] = None

        if normalized_path:
            try:
                path_obj = Path(normalized_path)
                if path_obj.is_absolute():
                    resolved = path_obj.resolve()
                    absolute_path = str(resolved)
                    try:
                        project_relative = str(
                            resolved.relative_to(ServerConfig.PROJECT_ROOT)
                        ).replace("\\", "/")
                    except ValueError:
                        project_relative = normalized_path
                else:
                    project_relative = normalized_path
                    absolute_path = str(
                        (ServerConfig.PROJECT_ROOT / path_obj).resolve()
                    )
            except Exception:
                absolute_path = absolute_path or normalized_path

        if absolute_path is None and project_relative:
            try:
                absolute_path = str(
                    (ServerConfig.PROJECT_ROOT / Path(project_relative)).resolve()
                )
            except Exception:
                absolute_path = None

        if project_relative is None and absolute_path:
            try:
                project_relative = str(
                    Path(absolute_path).resolve().relative_to(ServerConfig.PROJECT_ROOT)
                ).replace("\\", "/")
            except Exception:
                project_relative = normalized_path or None

        chunk_index = chunk.chunk_index if isinstance(chunk.chunk_index, int) else None
        snippet = (chunk.content or "").strip()
        if snippet:
            snippet = textwrap.shorten(
                snippet, width=REFERENCE_SNIPPET_MAX_CHARS, placeholder="..."
            )

        entry = reference_map.setdefault(
            key,
            {
                "document": ReferenceDocument(
                    document_id=document_id,
                    filename=filename,
                    file_path=file_path,
                    display_name=filename,
                    absolute_path=absolute_path,
                    project_relative_path=project_relative,
                    score=chunk.score,
                    chunk_indices=[chunk_index] if chunk_index is not None else [],
                ),
                "snippets": [],
                "scores": [],
            },
        )

        reference = entry["document"]
        if chunk_index is not None and chunk_index not in reference.chunk_indices:
            reference.chunk_indices.append(chunk_index)
        if chunk.score > (reference.score or float("-inf")):
            reference.score = chunk.score
        if reference.document_id is None and document_id is not None:
            reference.document_id = document_id
        if not reference.absolute_path and absolute_path:
            reference.absolute_path = absolute_path
        if not reference.project_relative_path and project_relative:
            reference.project_relative_path = project_relative
        if snippet:
            entry["snippets"].append(snippet)
        entry["scores"].append(chunk.score)

    references: List[ReferenceDocument] = []
    for entry in reference_map.values():
        reference = entry["document"]
        snippets = entry.get("snippets") or []
        if snippets and not reference.snippet:
            reference.snippet = snippets[0]
        # Deduplicate and sort chunk indices
        if reference.chunk_indices:
            reference.chunk_indices = sorted(
                {idx for idx in reference.chunk_indices if isinstance(idx, int)}
            )
        references.append(reference)

    references.sort(key=lambda ref: ref.score or 0.0, reverse=True)
    for idx, reference in enumerate(references, start=1):
        reference.reference_id = f"文档-{idx}"
        reference.selected = False
    return references


def _normalize_path(value: Optional[str]) -> str:
    if not value:
        return ""
    return str(value).replace("\\", "/").strip()


def _reference_matches_chunk(
    reference: ReferenceDocument, chunk: RetrievedChunk
) -> bool:
    if reference.document_id is not None and reference.document_id >= 0:
        if chunk.document_id == reference.document_id:
            return True
    ref_variants = {
        _normalize_path(reference.file_path),
        _normalize_path(reference.project_relative_path),
        _normalize_path(reference.absolute_path),
    }
    chunk_path = _normalize_path(chunk.file_path)
    if chunk_path and chunk_path in ref_variants:
        return True
    return False


def _collect_reference_chunks_backend(
    reference: ReferenceDocument, chunks: List[RetrievedChunk]
) -> List[RetrievedChunk]:
    matched = [chunk for chunk in chunks if _reference_matches_chunk(reference, chunk)]
    if matched:
        return matched
    # fallback: match by filename when no explicit path
    ref_name = (reference.filename or "").strip().lower()
    if not ref_name:
        return []
    return [
        chunk for chunk in chunks if (chunk.filename or "").strip().lower() == ref_name
    ]


def _format_reference_material(
    references: List[ReferenceDocument], chunks: List[RetrievedChunk]
) -> str:
    if not references:
        return ""

    entries: List[str] = []
    for reference in references:
        matched_chunks = _collect_reference_chunks_backend(reference, chunks)
        snippets: List[str] = []
        for chunk in matched_chunks[:2]:
            snippet = (chunk.content or "").strip()
            if snippet:
                snippets.append(
                    textwrap.shorten(
                        snippet, width=REFERENCE_SNIPPET_MAX_CHARS, placeholder="..."
                    )
                )
        if not snippets and reference.snippet:
            snippets.append(reference.snippet)
        if not snippets:
            snippets.append("（未提供片段摘录）")
        snippet_lines = [
            f"- 片段{idx + 1}: {textwrap.dedent(text).strip()}"
            for idx, text in enumerate(snippets)
        ]
        entry = "\n".join(
            [
                f"[{reference.reference_id}] {reference.display_name or reference.filename or '未命名文件'}",
                *snippet_lines,
            ]
        )
        entries.append(entry.strip())

    return "\n\n".join(entries)


REFERENCE_LINE_PATTERN = re.compile(
    r"^\s*参考文档\s*[:：]\s*(?P<value>.+?)\s*$", re.IGNORECASE
)
REFERENCE_NONE_TOKENS = {"无", "none", "null", "暂无", "无引用", "无参考", "无资料"}


def _normalize_reference_value(value: str) -> str:
    stripped = value.strip()
    stripped = stripped.replace("。", "").replace(".", "").strip()
    return stripped


def _apply_reference_selection(
    content: str, references: List[ReferenceDocument]
) -> Tuple[str, List[ReferenceDocument], List[str]]:
    lines = content.splitlines()
    selected_ids: List[str] = []
    matched_index: Optional[int] = None

    for idx in range(len(lines) - 1, -1, -1):
        line = lines[idx].strip()
        match = REFERENCE_LINE_PATTERN.match(line)
        if not match:
            continue
        matched_index = idx
        raw_value = match.group("value") or ""
        normalized_value = _normalize_reference_value(raw_value)
        if not normalized_value or normalized_value.lower() in REFERENCE_NONE_TOKENS:
            selected_ids = []
        else:
            tokens = re.split(r"[，,；;、\s]+", normalized_value)
            interim: List[str] = []
            for token in tokens:
                token_norm = token.strip().upper()
                if not token_norm:
                    continue
                if token_norm.lower() in REFERENCE_NONE_TOKENS:
                    interim = []
                    break
                interim.append(token_norm)
            selected_ids = interim
        break

    if matched_index is not None:
        lines.pop(matched_index)

    clean_content = "\n".join(lines).strip()
    if not clean_content:
        clean_content = content.strip()

    valid_lookup: Dict[str, str] = {
        reference.reference_id.upper(): reference.reference_id
        for reference in references
        if reference.reference_id
    }

    canonical_ids: List[str] = []
    for token in selected_ids:
        mapped = valid_lookup.get(token)
        if mapped and mapped not in canonical_ids:
            canonical_ids.append(mapped)

    selected_refs: List[ReferenceDocument] = []
    for reference in references:
        is_selected = reference.reference_id in canonical_ids
        reference.selected = is_selected
        if is_selected:
            selected_refs.append(reference)

    return clean_content, selected_refs, canonical_ids


def _build_llm_messages(
    question: str,
    conversation_messages: List[Dict[str, Any]],
    user_message_id: int,
    chunks: List[RetrievedChunk],
    references: List[ReferenceDocument],
    selection: ModelSelection,
    retrieval_context: Optional[Dict[str, Any]] = None,
) -> List[Dict[str, str]]:
    system_prompt = (
        "你是一名资深的企业知识助手，会综合提供的资料与自身掌握的通用知识回答问题。\n"
        "始终以用户当前提出的问题为核心进行分析；历史对话仅作为理解语境的参考，必要时可引用，但不得喧宾夺主。\n"
        "当提供了参考资料时要优先基于资料内容进行分析并给出贴合语境的总结；"
        "当未提供任何参考资料时，也需要依靠你的知识储备完整作答，不要刻意强调资料缺失。\n"
        "请始终使用 Markdown 输出，结构清晰、分层表达。"
    )

    messages: List[Dict[str, str]] = [{"role": "system", "content": system_prompt}]

    history_segments: List[str] = []
    for message in conversation_messages:
        if message.get("id") == user_message_id:
            continue
        role = message.get("role")
        content = (message.get("content") or "").strip()
        if role not in {"user", "assistant"} or not content:
            continue
        display_role = "用户" if role == "user" else "助手"
        snippet = content[:500] + ("…" if len(content) > 500 else "")
        history_segments.append(f"{display_role}：{snippet}")

    context_parts: List[str] = []

    reference_material = _format_reference_material(references, chunks)
    summary_mode = (
        retrieval_context is not None
        and retrieval_context.get("mode") == "summary"
        and bool(reference_material)
    )
    summary_matches = (
        (retrieval_context or {}).get("summary_matches") if summary_mode else None
    )
    if reference_material:
        if summary_mode:
            summary_count = len(summary_matches) if summary_matches else 0
            prefix = "以下文档依据主题概述自动匹配，已按相关性排序"
            if summary_count:
                prefix = f"{prefix}（共 {summary_count} 篇）"
            knowledge_text = (
                f"{prefix}，编号已给出，若引用请基于编号确认来源：\n"
                f"{reference_material}\n\n"
            )
        else:
            knowledge_text = (
                "以下是与用户问题可能相关的文档资料（编号已给出，若引用请基于编号确认来源）：\n"
                f"{reference_material}\n\n"
            )
        citation_instruction = (
            "如果你在答案中参考了上述任何文档，请在回答末尾另起一行，严格使用“参考文档: 文档-1,文档-3”的格式列出你真正使用过的文档编号，按重要性排序且不要重复。"
            "如果未使用任何文档，请在该行写“参考文档: 无”。除了这一行，不要在正文中输出诸如 [1]、(1) 或其他编号引用。"
        )
    else:
        knowledge_text = (
            "当前没有检索到任何外部参考资料。请直接依据你掌握的行业常识、经验与通用知识体系给出详尽、可靠的回答。"
            "可以在需要时做出合理推断，但若为推测请在回答中简要说明依据。\n\n"
        )
        citation_instruction = "回答末尾请添加一行“参考文档: 无”。"
    context_parts.append(knowledge_text)

    if history_segments:
        history_text = (
            "历史对话记录如下（仅供理解语境，若无助于回答请忽略）：\n"
            + "\n".join(history_segments)
            + "\n\n"
        )
        context_parts.append(history_text)

    user_prompt = (
        f"{''.join(context_parts)}"
        f"请聚焦以下最新问题，历史对话仅作参考：\n用户问题：{question}\n\n"
        "若参考资料包含答案，请据此总结；若参考资料缺失或不足，请运用自身专业知识完整作答。\n"
        f"{citation_instruction}"
    )
    messages.append({"role": "user", "content": user_prompt})
    return messages


def _build_llm_payload(
    selection: ModelSelection, messages: List[Dict[str, str]], stream: bool
) -> Dict[str, Any]:
    payload: Dict[str, Any] = {
        "model": selection.api_model,
        "messages": messages,
        "temperature": getattr(ServerConfig, "CHAT_TEMPERATURE", 0.3),
        "top_p": getattr(ServerConfig, "CHAT_TOP_P", 0.85),
        "stream": stream,
    }
    max_tokens = getattr(ServerConfig, "CHAT_MAX_TOKENS", None)
    if max_tokens:
        payload["max_tokens"] = max_tokens
    if selection.source_id == "modelscope":
        payload["extra_body"] = {
            "enable_thinking": bool(stream),
        }
    return payload


def _prepare_chat_context(
    question: str,
    conversation_id: Optional[int],
    top_k: int,
    selection: ModelSelection,
    use_summary_search: bool = False,
    client_request_id: Optional[str] = None,
) -> Dict[str, Any]:
    _ensure_dependencies(require_llm=True)
    assert sqlite_manager is not None

    normalized_question = question.strip()
    if not normalized_question:
        raise HTTPException(status_code=400, detail="问题不能为空")

    if conversation_id is not None:
        conversation = sqlite_manager.get_conversation_by_id(conversation_id)
        if not conversation:
            raise HTTPException(status_code=404, detail="Conversation not found")
    else:
        title = _generate_conversation_title(normalized_question)
        conversation_id = sqlite_manager.create_conversation(title)

    user_message_id = sqlite_manager.insert_chat_message(
        conversation_id, "user", normalized_question, metadata={"top_k": top_k}
    )

    _schedule_chat_progress(
        conversation_id,
        assistant_message_id=None,
        user_message_id=user_message_id,
        client_request_id=client_request_id,
        stage="understanding",
        message="正在理解问题",
        step=1,
    )

    conversation_messages = sqlite_manager.get_conversation_messages(conversation_id)

    _schedule_chat_progress(
        conversation_id,
        assistant_message_id=None,
        user_message_id=user_message_id,
        client_request_id=client_request_id,
        stage="retrieving",
        message="正在检索结果",
        step=2,
    )

    retrieval_context: Dict[str, Any] = {
        "mode": "baseline",
        "summary_search_requested": bool(use_summary_search),
        "summary_search_applied": False,
    }
    chunks: List[RetrievedChunk] = []
    summary_context: Optional[Dict[str, Any]] = None

    if use_summary_search:
        summary_payload = _retrieve_chunks_from_document_summaries(normalized_question)
        if summary_payload:
            chunks, summary_context = summary_payload
            retrieval_context = {
                **summary_context,
                "summary_search_requested": True,
                "summary_search_applied": summary_context.get(
                    "summary_search_applied", True
                ),
            }
            logger.debug(
                "基于文档摘要检索命中 %d 篇文档",
                len(summary_context.get("summary_matches", [])),
            )
        else:
            chunks = _retrieve_chunks(normalized_question, top_k)
            retrieval_context["summary_fallback"] = True
    else:
        chunks = _retrieve_chunks(normalized_question, top_k)

    if retrieval_context.get("mode") != "summary":
        retrieval_context["mode"] = "baseline"

    references = _build_references_from_chunks(chunks)

    selection_data = selection.model_dump(exclude={"api_key"}, exclude_none=True)
    assistant_metadata = {
        "query": normalized_question,
        "top_k": top_k,
        "model": selection_data,
        "chunks": [chunk.dict() for chunk in chunks],
        "available_references": [reference.dict() for reference in references],
        "references": [],
        "selected_reference_ids": [],
        "reference_mode": "retrieval" if references else "llm_only",
        "retrieval_mode": retrieval_context.get("mode"),
        "retrieval_context": retrieval_context,
        "use_summary_search": bool(use_summary_search),
    }
    if client_request_id:
        assistant_metadata["client_request_id"] = client_request_id

    assistant_message_id = sqlite_manager.insert_chat_message(
        conversation_id, "assistant", "", metadata=assistant_metadata
    )

    _schedule_chat_progress(
        conversation_id,
        assistant_message_id=assistant_message_id,
        user_message_id=user_message_id,
        client_request_id=client_request_id,
        stage="merging_retrieval",
        message="正在合并结果",
        step=3,
    )

    llm_messages = _build_llm_messages(
        normalized_question,
        conversation_messages,
        user_message_id,
        chunks,
        references,
        selection,
        retrieval_context=retrieval_context,
    )

    return {
        "conversation_id": conversation_id,
        "user_message_id": user_message_id,
        "assistant_message_id": assistant_message_id,
        "assistant_metadata": assistant_metadata,
        "chunks": chunks,
        "references": references,
        "llm_messages": llm_messages,
        "selection": selection,
        "client_request_id": client_request_id,
        "retrieval_context": retrieval_context,
    }


def _sse_event(event: str, data: Dict[str, Any]) -> str:
    # 采用 ensure_ascii=False 生成 UTF-8 JSON，并在响应层面声明 UTF-8
    payload = json.dumps({"event": event, "data": data}, ensure_ascii=False)
    return f"data: {payload}\n\n"


def _extract_stream_delta(chunk: Dict[str, Any]) -> str:
    choices = chunk.get("choices") or []
    if not choices:
        return ""
    choice = choices[0]
    delta = choice.get("delta")
    if delta and isinstance(delta, dict):
        reasoning = delta.get("reasoning_content")
        if reasoning:
            return reasoning
        return delta.get("content") or ""
    message = choice.get("message")
    if message and isinstance(message, dict):
        return message.get("content") or ""
    return ""


def _extract_completion_content(result: Dict[str, Any]) -> str:
    choices = result.get("choices") or []
    if not choices:
        return ""
    message = choices[0].get("message") or {}
    content = message.get("content") or ""
    return content


def _chat_stream_generator(payload: ChatStreamRequest) -> Generator[str, None, None]:
    try:
        context = _prepare_chat_context(
            payload.question,
            payload.conversation_id,
            payload.top_k,
            payload.model,
            use_summary_search=payload.use_summary_search,
            client_request_id=payload.client_request_id,
        )
    except HTTPException as exc:
        detail = exc.detail if isinstance(exc.detail, str) else "请求无效"
        yield _sse_event("error", {"message": detail})
        return
    except Exception as exc:  # pragma: no cover - defensive logging
        logger.exception("Failed to prepare chat context: %s", exc)
        yield _sse_event("error", {"message": "服务器内部错误，请稍后重试。"})
        return

    assert sqlite_manager is not None
    selection = payload.model
    assistant_metadata = context["assistant_metadata"]
    conversation_id = context["conversation_id"]
    assistant_message_id = context["assistant_message_id"]
    user_message_id = context["user_message_id"]
    client_request_id = context.get("client_request_id")

    yield _sse_event(
        "meta",
        {
            "conversation_id": conversation_id,
            "assistant_message_id": assistant_message_id,
            "metadata": assistant_metadata,
            "client_request_id": client_request_id,
            "user_message_id": user_message_id,
        },
    )

    llm_payload = _build_llm_payload(selection, context["llm_messages"], stream=True)
    buffer_parts: List[str] = []

    _schedule_chat_progress(
        conversation_id,
        assistant_message_id=assistant_message_id,
        user_message_id=user_message_id,
        client_request_id=client_request_id,
        stage="llm_invocation",
        message="正在调用模型",
        step=4,
    )

    try:
        _schedule_chat_progress(
            conversation_id,
            assistant_message_id=assistant_message_id,
            user_message_id=user_message_id,
            client_request_id=client_request_id,
            stage="thinking",
            message="正在思考中",
            step=5,
        )

        api_key = (selection.api_key or "").strip()
        if selection.source_id == "ollama":
            for raw_chunk in _stream_ollama_chat(selection, llm_payload):
                if isinstance(raw_chunk, dict):
                    usage_info = raw_chunk.get("usage")
                    if usage_info:
                        assistant_metadata["usage"] = usage_info
                delta = _extract_stream_delta(raw_chunk)
                if not delta:
                    continue
                buffer_parts.append(delta)
                yield _sse_event("chunk", {"delta": delta})
        elif selection.source_id == "modelscope":
            if not api_key:
                raise LLMClientError("缺少模型 API Key")
            for raw_chunk in _stream_modelscope_chat(api_key, llm_payload):
                usage_info = raw_chunk.get("usage")
                if usage_info:
                    assistant_metadata["usage"] = usage_info
                delta = _extract_stream_delta(raw_chunk)
                if not delta:
                    continue
                buffer_parts.append(delta)
                yield _sse_event("chunk", {"delta": delta})
        else:
            assert llm_client is not None
            if not api_key:
                raise LLMClientError("缺少模型 API Key")
            for raw_chunk in llm_client.stream_chat(api_key, llm_payload):
                delta = _extract_stream_delta(raw_chunk)
                if not delta:
                    continue
                buffer_parts.append(delta)
                yield _sse_event("chunk", {"delta": delta})

        final_content = "".join(buffer_parts).strip()
        if not final_content:
            final_content = "很抱歉，目前无法根据提供的资料给出答案。"

        available_refs: List[ReferenceDocument] = context["references"]
        final_content, selected_refs, selected_ids = _apply_reference_selection(
            final_content, available_refs
        )
        assistant_metadata["selected_reference_ids"] = selected_ids
        assistant_metadata["available_references"] = [
            reference.dict() for reference in available_refs
        ]
        assistant_metadata["references"] = [
            reference.dict() for reference in selected_refs
        ]
        assistant_metadata["reference_mode"] = (
            "retrieval" if selected_refs else "llm_only"
        )

        _schedule_chat_progress(
            conversation_id,
            assistant_message_id=assistant_message_id,
            user_message_id=user_message_id,
            client_request_id=client_request_id,
            stage="merging_answer",
            message="正在合并结果",
            step=6,
        )

        sqlite_manager.update_chat_message(
            context["assistant_message_id"],
            content=final_content,
            metadata=assistant_metadata,
            conversation_id=context["conversation_id"],
        )

        yield _sse_event(
            "done",
            {
                "conversation_id": context["conversation_id"],
                "assistant_message_id": context["assistant_message_id"],
                "content": final_content,
                "metadata": assistant_metadata,
            },
        )
        _schedule_chat_progress(
            conversation_id,
            assistant_message_id=assistant_message_id,
            user_message_id=user_message_id,
            client_request_id=client_request_id,
            stage="merging_answer",
            message="正在合并结果",
            step=6,
            status="completed",
        )
    except LLMClientError as exc:
        logger.warning("LLM streaming error: %s", exc)
        sqlite_manager.update_chat_message(
            context["assistant_message_id"],
            content="",
            metadata={**assistant_metadata, "error": str(exc)},
            conversation_id=context["conversation_id"],
        )
        yield _sse_event("error", {"message": str(exc)})
        _schedule_chat_progress(
            conversation_id,
            assistant_message_id=assistant_message_id,
            user_message_id=user_message_id,
            client_request_id=client_request_id,
            stage="error",
            message=str(exc),
            step=6,
            status="error",
        )
    except Exception as exc:  # pragma: no cover - defensive logging
        logger.exception("LLM streaming failed: %s", exc)
        sqlite_manager.update_chat_message(
            context["assistant_message_id"],
            content="",
            metadata={**assistant_metadata, "error": "internal_error"},
            conversation_id=context["conversation_id"],
        )
        yield _sse_event("error", {"message": "服务器内部错误，请稍后重试。"})
        _schedule_chat_progress(
            conversation_id,
            assistant_message_id=assistant_message_id,
            user_message_id=user_message_id,
            client_request_id=client_request_id,
            stage="error",
            message="服务器内部错误，请稍后重试。",
            step=6,
            status="error",
        )


@router.post("/stream")
async def chat_stream_endpoint(payload: ChatStreamRequest) -> StreamingResponse:
    _ensure_dependencies(require_llm=True)
    generator = _chat_stream_generator(payload)
    # 指定 UTF-8 编码，避免 SSE 在不同客户端出现乱码
    return StreamingResponse(generator, media_type="text/event-stream; charset=utf-8")


@router.post("", response_model=ChatResponse)
async def chat_endpoint(payload: ChatRequest) -> ChatResponse:
    _ensure_dependencies(require_llm=True)
    if payload.model is None:
        raise HTTPException(status_code=400, detail="缺少模型信息")

    try:
        context = _prepare_chat_context(
            payload.question,
            payload.conversation_id,
            payload.top_k,
            payload.model,
            use_summary_search=payload.use_summary_search,
            client_request_id=payload.client_request_id,
        )
    except HTTPException:
        raise
    except Exception as exc:  # pragma: no cover - defensive logging
        logger.exception("Failed to prepare chat context: %s", exc)
        raise HTTPException(status_code=500, detail="服务器内部错误") from exc

    selection = payload.model
    llm_payload = _build_llm_payload(selection, context["llm_messages"], stream=False)
    conversation_id = context["conversation_id"]
    assistant_message_id = context["assistant_message_id"]
    user_message_id = context["user_message_id"]
    client_request_id = context.get("client_request_id")

    _schedule_chat_progress(
        conversation_id,
        assistant_message_id=assistant_message_id,
        user_message_id=user_message_id,
        client_request_id=client_request_id,
        stage="llm_invocation",
        message="正在调用模型",
        step=4,
    )

    try:
        _schedule_chat_progress(
            conversation_id,
            assistant_message_id=assistant_message_id,
            user_message_id=user_message_id,
            client_request_id=client_request_id,
            stage="thinking",
            message="正在思考中",
            step=5,
        )
        api_key = (selection.api_key or "").strip()
        if selection.source_id == "ollama":
            result = _call_ollama_chat_completion(selection, llm_payload)
        elif selection.source_id == "modelscope":
            if not api_key:
                raise LLMClientError("缺少模型 API Key")
            result = _call_modelscope_chat_completion(api_key, llm_payload)
        else:
            assert llm_client is not None
            if not api_key:
                raise LLMClientError("缺少模型 API Key")
            result = llm_client.chat_completion(api_key, llm_payload)
    except LLMClientError as exc:
        sqlite_manager.update_chat_message(
            context["assistant_message_id"],
            content="",
            metadata={**context["assistant_metadata"], "error": str(exc)},
            conversation_id=context["conversation_id"],
        )
        _schedule_chat_progress(
            conversation_id,
            assistant_message_id=assistant_message_id,
            user_message_id=user_message_id,
            client_request_id=client_request_id,
            stage="error",
            message=str(exc),
            step=6,
            status="error",
        )
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except Exception as exc:  # pragma: no cover - defensive logging
        logger.exception("LLM request failed: %s", exc)
        sqlite_manager.update_chat_message(
            context["assistant_message_id"],
            content="",
            metadata={**context["assistant_metadata"], "error": "internal_error"},
            conversation_id=context["conversation_id"],
        )
        _schedule_chat_progress(
            conversation_id,
            assistant_message_id=assistant_message_id,
            user_message_id=user_message_id,
            client_request_id=client_request_id,
            stage="error",
            message="调用模型接口失败",
            step=6,
            status="error",
        )
        raise HTTPException(status_code=502, detail="调用模型接口失败") from exc

    final_content = _extract_completion_content(result)
    if not final_content.strip():
        final_content = "很抱歉，目前无法根据提供的资料给出答案。"

    usage_info = result.get("usage")
    if usage_info:
        context["assistant_metadata"]["usage"] = usage_info

    available_refs: List[ReferenceDocument] = context["references"]
    final_content, selected_refs, selected_ids = _apply_reference_selection(
        final_content, available_refs
    )
    context["assistant_metadata"]["selected_reference_ids"] = selected_ids
    context["assistant_metadata"]["available_references"] = [
        reference.dict() for reference in available_refs
    ]
    context["assistant_metadata"]["references"] = [
        reference.dict() for reference in selected_refs
    ]
    context["assistant_metadata"]["reference_mode"] = (
        "retrieval" if selected_refs else "llm_only"
    )

    _schedule_chat_progress(
        conversation_id,
        assistant_message_id=assistant_message_id,
        user_message_id=user_message_id,
        client_request_id=client_request_id,
        stage="merging_answer",
        message="正在合并结果",
        step=6,
    )

    sqlite_manager.update_chat_message(
        context["assistant_message_id"],
        content=final_content,
        metadata=context["assistant_metadata"],
        conversation_id=context["conversation_id"],
    )

    _schedule_chat_progress(
        conversation_id,
        assistant_message_id=assistant_message_id,
        user_message_id=user_message_id,
        client_request_id=client_request_id,
        stage="merging_answer",
        message="正在合并结果",
        step=6,
        status="completed",
    )

    messages = sqlite_manager.get_conversation_messages(context["conversation_id"])
    assistant_message = next(
        (
            message
            for message in messages
            if message["id"] == context["assistant_message_id"]
        ),
        None,
    )
    if assistant_message is None:
        raise HTTPException(
            status_code=500, detail="Failed to create assistant message"
        )

    selected_references = [
        reference for reference in context["references"] if reference.selected
    ]

    return ChatResponse(
        conversation_id=context["conversation_id"],
        messages=[ChatMessageModel(**message) for message in messages],
        assistant_message=ChatMessageModel(**assistant_message),
        chunks=context["chunks"],
        references=selected_references,
    )


@router.get("/conversations", response_model=List[ConversationSummary])
async def list_conversations_endpoint() -> List[ConversationSummary]:
    _ensure_dependencies()
    assert sqlite_manager is not None
    conversations = sqlite_manager.list_conversations()
    return [
        ConversationSummary(
            id=int(item["id"]),
            title=item["title"],
            created_time=item["created_time"],
            updated_time=item["updated_time"],
            last_message=item.get("last_message"),
            last_role=item.get("last_role"),
            message_count=int(item.get("message_count", 0)),
        )
        for item in conversations
    ]


@router.get("/conversations/{conversation_id}", response_model=ConversationDetail)
async def get_conversation_endpoint(conversation_id: int) -> ConversationDetail:
    _ensure_dependencies()
    assert sqlite_manager is not None

    conversation = sqlite_manager.get_conversation_by_id(conversation_id)
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")

    messages = sqlite_manager.get_conversation_messages(conversation_id)
    summary = ConversationSummary(
        id=int(conversation["id"]),
        title=conversation["title"],
        created_time=conversation["created_time"],
        updated_time=conversation["updated_time"],
        last_message=messages[-1]["content"] if messages else None,
        last_role=messages[-1]["role"] if messages else None,
        message_count=len(messages),
    )

    return ConversationDetail(
        conversation=summary,
        messages=[ChatMessageModel(**message) for message in messages],
    )


@router.delete("/conversations/{conversation_id}", status_code=204)
async def delete_conversation_endpoint(conversation_id: int) -> Response:
    _ensure_dependencies()
    assert sqlite_manager is not None
    deleted = sqlite_manager.delete_conversation(conversation_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return Response(status_code=204)
MODELSCOPE_BASE_URL = "https://api-inference.modelscope.cn/v1/"
