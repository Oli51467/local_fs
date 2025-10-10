import json
import logging
import textwrap
from typing import Any, Dict, Generator, List, Optional

from fastapi import APIRouter, HTTPException, Response
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from config.config import ServerConfig
from service.bm25s_service import BM25SService
from service.embedding_service import EmbeddingService
from service.faiss_service import FaissManager
from service.llm_client import LLMClientError, SiliconFlowClient
from service.sqlite_service import SQLiteManager


logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/chat", tags=["chat"])

faiss_manager: Optional[FaissManager] = None
sqlite_manager: Optional[SQLiteManager] = None
embedding_service: Optional[EmbeddingService] = None
bm25s_service: Optional[BM25SService] = None
llm_client: Optional[SiliconFlowClient] = None

MIN_CHUNK_SCORE = 0.3
MAX_HISTORY_MESSAGES = 8
MAX_CHUNK_CHARS = 800


class RetrievedChunk(BaseModel):
    document_id: int
    filename: str
    file_path: str
    chunk_index: int
    content: str
    score: float
    embedding_score: float
    bm25_score: Optional[float] = None
    bm25_raw_score: Optional[float] = None
    vector_id: Optional[int] = None


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
    llm_client_instance: Optional[SiliconFlowClient] = None,
) -> None:
    global faiss_manager, sqlite_manager, embedding_service, bm25s_service, llm_client
    faiss_manager = faiss_mgr
    sqlite_manager = sqlite_mgr
    embedding_service = embedding_srv
    bm25s_service = bm25s_srv
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

    query_vector = embedding_service.encode_text(question)
    recall_k = max(top_k * 4, 40)

    try:
        search_results = faiss_manager.search_vectors([query_vector], k=recall_k)
    except Exception as exc:  # pragma: no cover - defensive logging
        logger.error("Failed to search vectors: %s", exc)
        return []

    if not search_results:
        return []

    raw_candidates = search_results[0] if search_results else []
    if not raw_candidates:
        return []

    candidate_records: List[Dict[str, Any]] = []
    seen_keys = set()

    for item in raw_candidates:
        vector_id = item.get('vector_id')
        chunk_key = vector_id if vector_id is not None else (
            item.get('document_id'), item.get('chunk_index')
        )
        if chunk_key in seen_keys:
            continue
        seen_keys.add(chunk_key)

        chunk_record = None
        if vector_id is not None:
            try:
                chunk_record = sqlite_manager.get_chunk_by_vector_id(int(vector_id))
            except Exception as exc:  # pragma: no cover - defensive logging
                logger.warning("Failed to fetch chunk by vector id %s: %s", vector_id, exc)
                chunk_record = None

        if not chunk_record:
            continue

        content = chunk_record.get('content') or item.get('chunk_text') or ''
        if not content.strip():
            continue

        candidate_records.append({
            'vector_id': int(vector_id) if vector_id is not None else None,
            'document_id': chunk_record.get('document_id'),
            'filename': chunk_record.get('filename') or item.get('filename') or '',
            'file_path': chunk_record.get('file_path') or item.get('file_path') or '',
            'chunk_index': chunk_record.get('chunk_index', 0),
            'content': content,
            'embedding_score': float(item.get('score', 0.0))
        })

    if not candidate_records:
        return []

    bm25_scores: List[float] = [0.0] * len(candidate_records)
    bm25_service = bm25s_service
    if bm25_service is not None:
        try:
            corpus = [candidate['content'] for candidate in candidate_records]
            bm25_scores = bm25_service.score_documents(question, corpus)
        except Exception as exc:  # pragma: no cover - defensive logging
            logger.warning("BM25 scoring failed: %s", exc)
            bm25_scores = [0.0] * len(candidate_records)

    bm25_weight = ServerConfig.BM25S_WEIGHT
    embedding_weight = ServerConfig.EMBEDDING_WEIGHT
    total_weight = bm25_weight + embedding_weight
    if total_weight <= 0:
        bm25_weight = embedding_weight = 0.5
    else:
        bm25_weight /= total_weight
        embedding_weight /= total_weight

    ranked: List[RetrievedChunk] = []
    for idx, candidate in enumerate(candidate_records):
        bm25_raw = float(bm25_scores[idx]) if idx < len(bm25_scores) else 0.0
        bm25_norm = float(bm25_raw / (bm25_raw + 1.0)) if bm25_raw > 0 else 0.0
        final_score = candidate['embedding_score'] * embedding_weight
        if bm25_service is not None:
            final_score += bm25_norm * bm25_weight

        ranked.append(
            RetrievedChunk(
                document_id=int(candidate['document_id']) if candidate['document_id'] is not None else -1,
                filename=candidate['filename'],
                file_path=candidate['file_path'],
                chunk_index=int(candidate['chunk_index'] or 0),
                content=candidate['content'],
                score=final_score,
                embedding_score=candidate['embedding_score'],
                bm25_score=bm25_norm if bm25_service is not None else None,
                bm25_raw_score=bm25_raw if bm25_service is not None else None,
                vector_id=candidate['vector_id']
            )
        )

    ranked.sort(key=lambda chunk: (chunk.score, chunk.embedding_score), reverse=True)
    filtered = [
        chunk for chunk in ranked
        if chunk.score >= MIN_CHUNK_SCORE or (chunk.bm25_score is not None and chunk.bm25_score >= MIN_CHUNK_SCORE)
    ]
    if not filtered:
        filtered = ranked[:top_k]
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
        knowledge_text = "未检索到相关资料。请谨慎作答，必要时直接说明无法回答。\n\n"

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
