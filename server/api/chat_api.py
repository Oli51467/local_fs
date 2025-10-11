import json
import logging
import textwrap
from typing import Any, Dict, Generator, List, Optional, Set, Tuple

from fastapi import APIRouter, HTTPException, Response
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from config.config import ServerConfig
from service.bm25s_service import BM25SService
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

MAX_HISTORY_MESSAGES = 8
MAX_CHUNK_CHARS = 800

DENSE_RECALL_MULTIPLIER = 10
DENSE_RECALL_MIN = 120
DENSE_RECALL_MAX = 400

LEXICAL_RECALL_MULTIPLIER = 5
LEXICAL_RECALL_MIN = 80
LEXICAL_RECALL_MAX = 250

MERGED_CANDIDATE_LIMIT = 500
RERANK_CANDIDATE_LIMIT = 150

RERANK_FUSION_WEIGHT = 0.6
DENSE_FUSION_WEIGHT = 0.25
LEXICAL_FUSION_WEIGHT = 0.15

MIN_COMPONENT_SCORE = 0.4
MIN_FINAL_SCORE = 0.45


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


class ChatMessageModel(BaseModel):
    id: int
    conversation_id: int
    role: str
    content: str
    metadata: Optional[Dict[str, Any]] = None
    created_time: str


class ModelSelection(BaseModel):
    source_id: str = Field(..., description="模型来源 ID")
    model_id: str = Field(..., description="模型标识")
    api_model: str = Field(..., description="调用使用的模型名称")
    api_key: str = Field(..., description="对应的 API Key")
    provider_name: Optional[str] = Field(default=None, description="模型提供方名称")
    api_key_setting: Optional[str] = Field(default=None, description="设置页面中的 API Key 标识")


class ChatRequest(BaseModel):
    question: str = Field(..., min_length=1, description="用户提问内容")
    conversation_id: Optional[int] = Field(default=None, description="已有会话 ID")
    top_k: int = Field(default=5, ge=1, le=50, description="返回的片段数量")
    model: Optional[ModelSelection] = Field(default=None, description="指定使用的模型信息")


class ChatStreamRequest(ChatRequest):
    model: ModelSelection


class ChatResponse(BaseModel):
    conversation_id: int
    messages: List[ChatMessageModel]
    assistant_message: ChatMessageModel
    chunks: List[RetrievedChunk]


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


def _generate_conversation_title(question: str) -> str:
    normalized = ' '.join(question.strip().split())
    if not normalized:
        return '新对话'
    if len(normalized) > 60:
        return normalized[:57] + '...'
    return normalized


def _retrieve_chunks(question: str, top_k: int) -> List[RetrievedChunk]:
    assert embedding_service is not None and faiss_manager is not None and sqlite_manager is not None

    bm25_service = bm25s_service if bm25s_service and bm25s_service.is_available() else None
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

    def _fetch_chunk(vector_id: int, fallback: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
        if vector_id in chunk_cache:
            return chunk_cache[vector_id]
        try:
            record = sqlite_manager.get_chunk_by_vector_id(int(vector_id))
        except Exception as exc:  # pragma: no cover - defensive logging
            logger.warning("Failed to fetch chunk by vector id %s: %s", vector_id, exc)
            record = None
        if not record and fallback:
            # Fallback to metadata when sqlite missing (legacy indices)
            fallback_content = fallback.get('chunk_text') or fallback.get('text') or fallback.get('content') or ''
            if fallback_content:
                record = {
                    'document_id': fallback.get('document_id'),
                    'filename': fallback.get('filename') or '',
                    'file_path': fallback.get('file_path') or fallback.get('path') or '',
                    'chunk_index': fallback.get('chunk_index', 0),
                    'content': fallback_content,
                }
        chunk_cache[vector_id] = record
        return record

    def _get_candidate(vector_id: int, source_payload: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
        if vector_id is None or vector_id < 0:
            return None
        if vector_id in candidate_map:
            return candidate_map[vector_id]

        chunk_record = _fetch_chunk(vector_id, source_payload)
        if not chunk_record:
            return None

        content = (chunk_record.get('content') or '').strip()
        if not content:
            return None

        candidate = {
            'vector_id': int(vector_id),
            'document_id': chunk_record.get('document_id'),
            'filename': chunk_record.get('filename') or (source_payload or {}).get('filename') or '',
            'file_path': chunk_record.get('file_path') or (source_payload or {}).get('file_path') or '',
            'chunk_index': chunk_record.get('chunk_index', 0),
            'content': content,
            'embedding_score': None,
            'embedding_norm': None,
            'bm25_raw': None,
            'bm25_norm': None,
            'rerank_score': None,
            'rerank_norm': None,
            'dense_rank': None,
            'lexical_rank': None,
            'sources': set(),  # type: Set[str]
        }
        candidate_map[vector_id] = candidate
        return candidate

    query_vector = embedding_service.encode_text(question)
    dense_limit = min(max(top_k * DENSE_RECALL_MULTIPLIER, DENSE_RECALL_MIN), DENSE_RECALL_MAX)

    try:
        dense_results = faiss_manager.search_vectors([query_vector], k=dense_limit)
    except Exception as exc:  # pragma: no cover - defensive logging
        logger.error("Failed to search vectors: %s", exc)
        dense_results = []

    if dense_results:
        for idx, item in enumerate(dense_results[0][:dense_limit]):
            vector_id = item.get('vector_id')
            candidate = _get_candidate(int(vector_id) if vector_id is not None else -1, item)
            if not candidate:
                continue
            candidate['sources'].add('dense')
            candidate['dense_rank'] = idx + 1 if candidate.get('dense_rank') is None else min(candidate['dense_rank'], idx + 1)
            score = item.get('score')
            if score is not None:
                embedding_score = float(score)
                candidate['embedding_score'] = embedding_score
                candidate['embedding_norm'] = _normalize_embedding(embedding_score)

    lexical_limit = min(max(top_k * LEXICAL_RECALL_MULTIPLIER, LEXICAL_RECALL_MIN), LEXICAL_RECALL_MAX)
    if bm25_service and lexical_limit > 0:
        try:
            lexical_results = bm25_service.retrieve(question, top_k=lexical_limit)
        except Exception as exc:  # pragma: no cover - defensive logging
            logger.warning("BM25 retrieval failed: %s", exc)
            lexical_results = []

        for item in lexical_results:
            doc_id = item.get('doc_id')
            try:
                doc_index = int(doc_id)
            except (TypeError, ValueError):
                doc_index = None

            meta: Optional[Dict[str, Any]] = None
            vector_id_meta: Optional[int] = None
            if doc_index is not None and 0 <= doc_index < len(faiss_manager.metadata):
                meta = faiss_manager.metadata[doc_index]
                vector_id_meta = meta.get('vector_id')
            if vector_id_meta is None:
                # 兼容旧数据，尝试使用doc_index作为vector id
                vector_id_meta = doc_index

            if vector_id_meta is None:
                continue

            candidate = _get_candidate(int(vector_id_meta), meta)
            if not candidate:
                continue

            candidate['sources'].add('lexical')
            rank = item.get('rank')
            if isinstance(rank, int):
                candidate['lexical_rank'] = rank if candidate.get('lexical_rank') is None else min(candidate['lexical_rank'], rank)
            bm25_raw = item.get('score')
            if bm25_raw is not None:
                raw_val = float(bm25_raw)
                candidate['bm25_raw'] = raw_val
                candidate['bm25_norm'] = _normalize_bm25(raw_val)

    candidates: List[Dict[str, Any]] = list(candidate_map.values())
    if not candidates:
        return []

    for candidate in candidates:
        emb_norm = candidate.get('embedding_norm')
        bm_norm = candidate.get('bm25_norm')
        candidate['pre_score'] = (emb_norm or 0.0) + (bm_norm or 0.0)

    candidates.sort(
        key=lambda item: (
            item.get('pre_score', 0.0),
            item.get('embedding_norm', 0.0),
            item.get('bm25_norm', 0.0)
        ),
        reverse=True
    )

    if len(candidates) > MERGED_CANDIDATE_LIMIT:
        candidates = candidates[:MERGED_CANDIDATE_LIMIT]

    rerank_input = [candidate for candidate in candidates if candidate.get('content')]
    rerank_limit = min(max(top_k * 6, 60), RERANK_CANDIDATE_LIMIT)
    rerank_limit = min(rerank_limit, len(rerank_input))

    if reranker is not None and rerank_limit > 0:
        try:
            rerank_scores = reranker.rerank_results(
                question,
                [candidate['content'] for candidate in rerank_input[:rerank_limit]],
                normalize=True
            )
        except Exception as exc:  # pragma: no cover - defensive logging
            logger.warning("Reranker scoring failed: %s", exc)
            rerank_scores = []

        for idx, (candidate, score) in enumerate(zip(rerank_input[:rerank_limit], rerank_scores)):
            try:
                normalized_score = max(0.0, min(1.0, float(score)))
            except (TypeError, ValueError):
                normalized_score = 0.0
            candidate['sources'].add('reranker')
            candidate['rerank_score'] = float(score)
            candidate['rerank_norm'] = normalized_score
            candidate['rerank_rank'] = idx + 1

    ranked: List[RetrievedChunk] = []
    for candidate in candidates:
        emb_norm = candidate.get('embedding_norm')
        bm_norm = candidate.get('bm25_norm')
        rr_norm = candidate.get('rerank_norm')

        weight_rerank = RERANK_FUSION_WEIGHT if rr_norm is not None else 0.0
        weight_dense = DENSE_FUSION_WEIGHT if emb_norm is not None else 0.0
        weight_lex = LEXICAL_FUSION_WEIGHT if bm_norm is not None else 0.0

        weight_sum = weight_rerank + weight_dense + weight_lex
        if weight_sum <= 0.0:
            final_score = emb_norm or bm_norm or 0.0
        else:
            final_score = (
                (rr_norm or 0.0) * weight_rerank +
                (emb_norm or 0.0) * weight_dense +
                (bm_norm or 0.0) * weight_lex
            ) / weight_sum

        candidate['final_score'] = final_score

        score_breakdown = {}
        if rr_norm is not None:
            score_breakdown['reranker'] = rr_norm
        if emb_norm is not None:
            score_breakdown['dense'] = emb_norm
        if bm_norm is not None:
            score_breakdown['lexical'] = bm_norm

        score_weights = {}
        if weight_sum > 0:
            if weight_rerank > 0:
                score_weights['reranker'] = weight_rerank / weight_sum
            if weight_dense > 0:
                score_weights['dense'] = weight_dense / weight_sum
            if weight_lex > 0:
                score_weights['lexical'] = weight_lex / weight_sum

        ranked.append(
            RetrievedChunk(
                document_id=int(candidate.get('document_id')) if candidate.get('document_id') is not None else -1,
                filename=candidate.get('filename') or '',
                file_path=candidate.get('file_path') or '',
                chunk_index=int(candidate.get('chunk_index') or 0),
                content=candidate.get('content') or '',
                score=float(final_score),
                embedding_score=candidate.get('embedding_score'),
                embedding_score_normalized=emb_norm,
                bm25_score=bm_norm,
                bm25_raw_score=candidate.get('bm25_raw'),
                rerank_score=candidate.get('rerank_score'),
                rerank_score_normalized=rr_norm,
                vector_id=candidate.get('vector_id'),
                sources=sorted(candidate.get('sources', [])),
                score_breakdown=score_breakdown or None,
                score_weights=score_weights or None,
                dense_rank=candidate.get('dense_rank'),
                lexical_rank=candidate.get('lexical_rank'),
                rerank_rank=candidate.get('rerank_rank')
            )
        )

    ranked.sort(
        key=lambda chunk: (
            chunk.score,
            chunk.rerank_score_normalized or 0.0,
            chunk.embedding_score_normalized or 0.0,
            chunk.bm25_score or 0.0
        ),
        reverse=True
    )

    def _passes_threshold(chunk: RetrievedChunk) -> bool:
        components = [
            chunk.embedding_score_normalized,
            chunk.bm25_score,
            chunk.rerank_score_normalized
        ]
        for comp in components:
            if comp is not None and comp < MIN_COMPONENT_SCORE:
                return False
        return chunk.score >= MIN_FINAL_SCORE

    filtered = [chunk for chunk in ranked if _passes_threshold(chunk)]
    return filtered[:top_k]


def _format_chunks_for_prompt(chunks: List[RetrievedChunk]) -> str:
    if not chunks:
        return ''

    formatted_segments: List[str] = []
    for idx, chunk in enumerate(chunks, start=1):
        content = (chunk.content or '').strip()
        if not content:
            continue
        if len(content) > MAX_CHUNK_CHARS:
            content = content[:MAX_CHUNK_CHARS] + '...'
        formatted_segments.append(
            f"[资料 {idx}]（来源：{chunk.filename or '未知文件'}）\n{textwrap.dedent(content)}"
        )
    return '\n\n'.join(formatted_segments)


def _build_llm_messages(
    question: str,
    conversation_messages: List[Dict[str, Any]],
    user_message_id: int,
    chunks: List[RetrievedChunk],
    selection: ModelSelection
) -> List[Dict[str, str]]:
    system_prompt = (
        "你是一名资深的企业知识助手，会结合提供的资料回答问题。\n"
        "请始终使用 Markdown 输出，结构清晰、分层表达。"
        "若资料不足，需明确说明并指出可能的补充方向。"
    )

    messages: List[Dict[str, str]] = [{'role': 'system', 'content': system_prompt}]

    history: List[Dict[str, str]] = []
    for message in conversation_messages:
        if message.get('id') == user_message_id:
            continue
        role = message.get('role')
        content = message.get('content')
        if role not in {'user', 'assistant'} or not content:
            continue
        history.append({'role': role, 'content': content})

    if history:
        history = history[-MAX_HISTORY_MESSAGES:]
        messages.extend(history)

    knowledge_block = _format_chunks_for_prompt(chunks)
    if knowledge_block:
        knowledge_text = f"以下资料可供参考：\n{knowledge_block}\n\n"
    else:
        knowledge_text = (
            "未检索到足够的相关资料。请谨慎作答，必要时明确说明，同时可以发挥自身知识完成回答。\n\n"
        )

    user_prompt = (
        f"{knowledge_text}"
        f"用户问题：{question}\n\n"
        "请基于资料给出严谨、结构化的回答。引用资料时可以在段落末尾注明（资料编号）。"
    )
    messages.append({'role': 'user', 'content': user_prompt})
    return messages


def _build_llm_payload(selection: ModelSelection, messages: List[Dict[str, str]], stream: bool) -> Dict[str, Any]:
    payload: Dict[str, Any] = {
        "model": selection.api_model,
        "messages": messages,
        "temperature": getattr(ServerConfig, 'CHAT_TEMPERATURE', 0.3),
        "top_p": getattr(ServerConfig, 'CHAT_TOP_P', 0.85),
        "stream": stream
    }
    max_tokens = getattr(ServerConfig, 'CHAT_MAX_TOKENS', None)
    if max_tokens:
        payload["max_tokens"] = max_tokens
    return payload


def _prepare_chat_context(
    question: str,
    conversation_id: Optional[int],
    top_k: int,
    selection: ModelSelection
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
        conversation_id,
        'user',
        normalized_question,
        metadata={'top_k': top_k}
    )

    conversation_messages = sqlite_manager.get_conversation_messages(conversation_id)
    chunks = _retrieve_chunks(normalized_question, top_k)

    selection_data = selection.model_dump(exclude={'api_key'}, exclude_none=True)
    assistant_metadata = {
        'query': normalized_question,
        'top_k': top_k,
        'model': selection_data,
        'chunks': [chunk.dict() for chunk in chunks]
    }

    assistant_message_id = sqlite_manager.insert_chat_message(
        conversation_id,
        'assistant',
        '',
        metadata=assistant_metadata
    )

    llm_messages = _build_llm_messages(
        normalized_question,
        conversation_messages,
        user_message_id,
        chunks,
        selection
    )

    return {
        'conversation_id': conversation_id,
        'user_message_id': user_message_id,
        'assistant_message_id': assistant_message_id,
        'assistant_metadata': assistant_metadata,
        'chunks': chunks,
        'llm_messages': llm_messages,
        'selection': selection
    }


def _sse_event(event: str, data: Dict[str, Any]) -> str:
    # 采用 ensure_ascii=False 生成 UTF-8 JSON，并在响应层面声明 UTF-8
    payload = json.dumps({'event': event, 'data': data}, ensure_ascii=False)
    return f"data: {payload}\n\n"


def _extract_stream_delta(chunk: Dict[str, Any]) -> str:
    choices = chunk.get('choices') or []
    if not choices:
        return ''
    choice = choices[0]
    delta = choice.get('delta')
    if delta and isinstance(delta, dict):
        return delta.get('content') or ''
    message = choice.get('message')
    if message and isinstance(message, dict):
        return message.get('content') or ''
    return ''


def _extract_completion_content(result: Dict[str, Any]) -> str:
    choices = result.get('choices') or []
    if not choices:
        return ''
    message = choices[0].get('message') or {}
    content = message.get('content') or ''
    return content


def _chat_stream_generator(payload: ChatStreamRequest) -> Generator[str, None, None]:
    try:
        context = _prepare_chat_context(payload.question, payload.conversation_id, payload.top_k, payload.model)
    except HTTPException as exc:
        detail = exc.detail if isinstance(exc.detail, str) else '请求无效'
        yield _sse_event('error', {'message': detail})
        return
    except Exception as exc:  # pragma: no cover - defensive logging
        logger.exception('Failed to prepare chat context: %s', exc)
        yield _sse_event('error', {'message': '服务器内部错误，请稍后重试。'})
        return

    assert sqlite_manager is not None
    selection = payload.model
    assistant_metadata = context['assistant_metadata']

    yield _sse_event('meta', {
        'conversation_id': context['conversation_id'],
        'assistant_message_id': context['assistant_message_id'],
        'metadata': assistant_metadata
    })

    llm_payload = _build_llm_payload(selection, context['llm_messages'], stream=True)
    buffer_parts: List[str] = []

    try:
        assert llm_client is not None
        for raw_chunk in llm_client.stream_chat(selection.api_key, llm_payload):
            delta = _extract_stream_delta(raw_chunk)
            if not delta:
                continue
            buffer_parts.append(delta)
            yield _sse_event('chunk', {'delta': delta})

        final_content = ''.join(buffer_parts).strip()
        if not final_content:
            final_content = '很抱歉，目前无法根据提供的资料给出答案。'

        sqlite_manager.update_chat_message(
            context['assistant_message_id'],
            content=final_content,
            metadata=assistant_metadata,
            conversation_id=context['conversation_id']
        )

        yield _sse_event('done', {
            'conversation_id': context['conversation_id'],
            'assistant_message_id': context['assistant_message_id'],
            'content': final_content,
            'metadata': assistant_metadata
        })
    except LLMClientError as exc:
        logger.warning('LLM streaming error: %s', exc)
        sqlite_manager.update_chat_message(
            context['assistant_message_id'],
            content='',
            metadata={**assistant_metadata, 'error': str(exc)},
            conversation_id=context['conversation_id']
        )
        yield _sse_event('error', {'message': str(exc)})
    except Exception as exc:  # pragma: no cover - defensive logging
        logger.exception('LLM streaming failed: %s', exc)
        sqlite_manager.update_chat_message(
            context['assistant_message_id'],
            content='',
            metadata={**assistant_metadata, 'error': 'internal_error'},
            conversation_id=context['conversation_id']
        )
        yield _sse_event('error', {'message': '服务器内部错误，请稍后重试。'})


@router.post('/stream')
async def chat_stream_endpoint(payload: ChatStreamRequest) -> StreamingResponse:
    _ensure_dependencies(require_llm=True)
    generator = _chat_stream_generator(payload)
    # 指定 UTF-8 编码，避免 SSE 在不同客户端出现乱码
    return StreamingResponse(generator, media_type='text/event-stream; charset=utf-8')


@router.post('', response_model=ChatResponse)
async def chat_endpoint(payload: ChatRequest) -> ChatResponse:
    _ensure_dependencies(require_llm=True)
    if payload.model is None:
        raise HTTPException(status_code=400, detail="缺少模型信息")

    try:
        context = _prepare_chat_context(payload.question, payload.conversation_id, payload.top_k, payload.model)
    except HTTPException:
        raise
    except Exception as exc:  # pragma: no cover - defensive logging
        logger.exception('Failed to prepare chat context: %s', exc)
        raise HTTPException(status_code=500, detail="服务器内部错误") from exc

    selection = payload.model
    llm_payload = _build_llm_payload(selection, context['llm_messages'], stream=False)

    try:
        assert llm_client is not None
        result = llm_client.chat_completion(selection.api_key, llm_payload)
    except LLMClientError as exc:
        sqlite_manager.update_chat_message(
            context['assistant_message_id'],
            content='',
            metadata={**context['assistant_metadata'], 'error': str(exc)},
            conversation_id=context['conversation_id']
        )
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except Exception as exc:  # pragma: no cover - defensive logging
        logger.exception('LLM request failed: %s', exc)
        sqlite_manager.update_chat_message(
            context['assistant_message_id'],
            content='',
            metadata={**context['assistant_metadata'], 'error': 'internal_error'},
            conversation_id=context['conversation_id']
        )
        raise HTTPException(status_code=502, detail="调用模型接口失败") from exc

    final_content = _extract_completion_content(result)
    if not final_content.strip():
        final_content = '很抱歉，目前无法根据提供的资料给出答案。'

    usage_info = result.get('usage')
    if usage_info:
        context['assistant_metadata']['usage'] = usage_info

    sqlite_manager.update_chat_message(
        context['assistant_message_id'],
        content=final_content,
        metadata=context['assistant_metadata'],
        conversation_id=context['conversation_id']
    )

    messages = sqlite_manager.get_conversation_messages(context['conversation_id'])
    assistant_message = next(
        (message for message in messages if message['id'] == context['assistant_message_id']),
        None
    )
    if assistant_message is None:
        raise HTTPException(status_code=500, detail="Failed to create assistant message")

    return ChatResponse(
        conversation_id=context['conversation_id'],
        messages=[ChatMessageModel(**message) for message in messages],
        assistant_message=ChatMessageModel(**assistant_message),
        chunks=context['chunks'],
    )


@router.get('/conversations', response_model=List[ConversationSummary])
async def list_conversations_endpoint() -> List[ConversationSummary]:
    _ensure_dependencies()
    assert sqlite_manager is not None
    conversations = sqlite_manager.list_conversations()
    return [
        ConversationSummary(
            id=int(item['id']),
            title=item['title'],
            created_time=item['created_time'],
            updated_time=item['updated_time'],
            last_message=item.get('last_message'),
            last_role=item.get('last_role'),
            message_count=int(item.get('message_count', 0)),
        )
        for item in conversations
    ]


@router.get('/conversations/{conversation_id}', response_model=ConversationDetail)
async def get_conversation_endpoint(conversation_id: int) -> ConversationDetail:
    _ensure_dependencies()
    assert sqlite_manager is not None

    conversation = sqlite_manager.get_conversation_by_id(conversation_id)
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")

    messages = sqlite_manager.get_conversation_messages(conversation_id)
    summary = ConversationSummary(
        id=int(conversation['id']),
        title=conversation['title'],
        created_time=conversation['created_time'],
        updated_time=conversation['updated_time'],
        last_message=messages[-1]['content'] if messages else None,
        last_role=messages[-1]['role'] if messages else None,
        message_count=len(messages),
    )

    return ConversationDetail(
        conversation=summary,
        messages=[ChatMessageModel(**message) for message in messages]
    )


@router.delete('/conversations/{conversation_id}', status_code=204)
async def delete_conversation_endpoint(conversation_id: int) -> Response:
    _ensure_dependencies()
    assert sqlite_manager is not None
    deleted = sqlite_manager.delete_conversation(conversation_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return Response(status_code=204)
