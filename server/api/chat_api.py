import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from config.config import ServerConfig
from service.bm25s_service import BM25SService
from service.embedding_service import EmbeddingService
from service.faiss_service import FaissManager
from service.sqlite_service import SQLiteManager

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/chat", tags=["chat"])

faiss_manager: Optional[FaissManager] = None
sqlite_manager: Optional[SQLiteManager] = None
embedding_service: Optional[EmbeddingService] = None
bm25s_service: Optional[BM25SService] = None


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


class ChatRequest(BaseModel):
    question: str = Field(..., min_length=1, description="用户提问内容")
    conversation_id: Optional[int] = Field(default=None, description="已有会话ID")
    top_k: int = Field(default=5, ge=1, le=50, description="返回片段数量")


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
) -> None:
    global faiss_manager, sqlite_manager, embedding_service, bm25s_service
    faiss_manager = faiss_mgr
    sqlite_manager = sqlite_mgr
    embedding_service = embedding_srv
    bm25s_service = bm25s_srv


def _ensure_dependencies() -> None:
    if not all([faiss_manager, sqlite_manager, embedding_service]):
        raise HTTPException(status_code=503, detail="Chat service is not ready")


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
    return ranked[:top_k]


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


@router.post('', response_model=ChatResponse)
async def chat_endpoint(payload: ChatRequest) -> ChatResponse:
    _ensure_dependencies()
    assert sqlite_manager is not None

    question = payload.question.strip()
    if not question:
        raise HTTPException(status_code=400, detail="问题不能为空")

    conversation_id = payload.conversation_id
    if conversation_id is not None:
        conversation = sqlite_manager.get_conversation_by_id(conversation_id)
        if not conversation:
            raise HTTPException(status_code=404, detail="Conversation not found")
    else:
        title = _generate_conversation_title(question)
        conversation_id = sqlite_manager.create_conversation(title)

    user_message_id = sqlite_manager.insert_chat_message(
        conversation_id,
        'user',
        question,
        metadata={'top_k': payload.top_k}
    )

    chunks = _retrieve_chunks(question, payload.top_k)

    if chunks:
        assistant_content_lines = [
            f"{idx + 1}. {chunk.content}" for idx, chunk in enumerate(chunks)
        ]
        assistant_content = '\n\n'.join(assistant_content_lines)
    else:
        assistant_content = '未检索到相关内容。'

    assistant_metadata = {
        'query': question,
        'top_k': payload.top_k,
        'chunks': [chunk.dict() for chunk in chunks]
    }

    assistant_message_id = sqlite_manager.insert_chat_message(
        conversation_id,
        'assistant',
        assistant_content,
        metadata=assistant_metadata
    )

    messages = sqlite_manager.get_conversation_messages(conversation_id)
    assistant_message = next(
        (message for message in messages if message['id'] == assistant_message_id),
        None
    )
    if assistant_message is None:
        raise HTTPException(status_code=500, detail="Failed to create assistant message")

    return ChatResponse(
        conversation_id=conversation_id,
        messages=[ChatMessageModel(**message) for message in messages],
        assistant_message=ChatMessageModel(**assistant_message),
        chunks=chunks,
    )
