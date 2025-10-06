import json
from datetime import datetime, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from server.api.chat_api import init_chat_api, router as chat_router


class FakeEmbeddingService:
    def encode_text(self, text: str):
        # 返回一个固定长度的向量即可满足接口需求
        return [float(len(text) % 5 + 1.0) for _ in range(4)]


class FakeFaissManager:
    def __init__(self, results=None):
        self._results = results or [[]]

    def search_vectors(self, query_vectors, k=10):
        return self._results


class FakeSQLiteManager:
    def __init__(self):
        self.conversations = {}
        self.messages = {}
        self.chunks_by_vector = {}
        self._next_conversation_id = 1
        self._next_message_id = 1
        self._base_time = datetime(2024, 1, 1, 0, 0, 0)

    def _timestamp(self):
        offset = timedelta(seconds=self._next_message_id)
        return (self._base_time + offset).isoformat() + 'Z'

    def create_conversation(self, title: str) -> int:
        conversation_id = self._next_conversation_id
        self._next_conversation_id += 1
        timestamp = self._timestamp()
        self.conversations[conversation_id] = {
            'id': conversation_id,
            'title': title,
            'created_time': timestamp,
            'updated_time': timestamp,
            'last_message': None,
            'last_role': None,
        }
        self.messages[conversation_id] = []
        return conversation_id

    def update_conversation_title(self, conversation_id: int, title: str) -> bool:
        if conversation_id not in self.conversations:
            return False
        self.conversations[conversation_id]['title'] = title
        return True

    def insert_chat_message(self, conversation_id: int, role: str, content: str, metadata=None) -> int:
        if conversation_id not in self.messages:
            self.messages[conversation_id] = []
        message_id = self._next_message_id
        self._next_message_id += 1
        timestamp = self._timestamp()
        message = {
            'id': message_id,
            'conversation_id': conversation_id,
            'role': role,
            'content': content,
            'metadata': json.loads(json.dumps(metadata)) if metadata is not None else None,
            'created_time': timestamp,
        }
        self.messages[conversation_id].append(message)

        conversation = self.conversations[conversation_id]
        conversation['updated_time'] = timestamp
        conversation['last_message'] = content
        conversation['last_role'] = role
        return message_id

    def get_conversation_messages(self, conversation_id: int):
        return [dict(message) for message in self.messages.get(conversation_id, [])]

    def get_conversation_by_id(self, conversation_id: int):
        return self.conversations.get(conversation_id)

    def list_conversations(self):
        items = []
        for conversation_id, payload in self.conversations.items():
            messages = self.messages.get(conversation_id, [])
            items.append({
                'id': conversation_id,
                'title': payload['title'],
                'created_time': payload['created_time'],
                'updated_time': payload['updated_time'],
                'last_message': payload.get('last_message'),
                'last_role': payload.get('last_role'),
                'message_count': len(messages),
            })
        items.sort(key=lambda item: item['updated_time'], reverse=True)
        return items

    def get_chunk_by_vector_id(self, vector_id: int):
        return self.chunks_by_vector.get(vector_id)

    def touch_conversation(self, conversation_id: int) -> None:
        if conversation_id in self.conversations:
            self.conversations[conversation_id]['updated_time'] = self._timestamp()


class FakeBM25Service:
    def __init__(self, scores):
        self._scores = scores

    def score_documents(self, query, documents):
        return list(self._scores[: len(documents)])


def create_test_client(fake_faiss, fake_sqlite, fake_embedding, fake_bm25=None):
    app = FastAPI()
    init_chat_api(fake_faiss, fake_sqlite, fake_embedding, fake_bm25)
    app.include_router(chat_router)
    client = TestClient(app)
    return client


@pytest.fixture(autouse=True)
def reset_bm25():
    from server.api import chat_api
    chat_api.bm25s_service = None


def test_chat_creates_new_conversation_without_results():
    fake_sqlite = FakeSQLiteManager()
    fake_faiss = FakeFaissManager(results=[[]])
    fake_embedding = FakeEmbeddingService()
    client = create_test_client(fake_faiss, fake_sqlite, fake_embedding)

    response = client.post('/api/chat', json={'question': '你好，世界', 'top_k': 3})
    assert response.status_code == 200
    payload = response.json()

    assert isinstance(payload['conversation_id'], int)
    assert payload['chunks'] == []
    assert len(payload['messages']) == 2
    assert payload['messages'][0]['role'] == 'user'
    assert payload['messages'][0]['content'] == '你好，世界'
    assert payload['assistant_message']['role'] == 'assistant'
    assert payload['assistant_message']['metadata']['chunks'] == []
    assert len(fake_sqlite.conversations) == 1

    history = client.get('/api/chat/conversations')
    assert history.status_code == 200
    conversations = history.json()
    assert len(conversations) == 1
    assert conversations[0]['message_count'] == 2


def test_chat_returns_retrieved_chunks():
    fake_sqlite = FakeSQLiteManager()
    fake_sqlite.chunks_by_vector[42] = {
        'document_id': 7,
        'filename': 'demo.txt',
        'file_path': 'docs/demo.txt',
        'chunk_index': 0,
        'content': '示例内容，验证检索结果。'
    }

    fake_faiss = FakeFaissManager(results=[[
        {
            'vector_id': 42,
            'score': 0.85,
            'filename': 'demo.txt',
            'file_path': 'docs/demo.txt',
            'chunk_index': 0
        }
    ]])
    fake_embedding = FakeEmbeddingService()
    client = create_test_client(fake_faiss, fake_sqlite, fake_embedding, FakeBM25Service([1.5]))

    response = client.post('/api/chat', json={'question': '演示问题', 'top_k': 3})
    assert response.status_code == 200
    payload = response.json()

    assert payload['chunks']
    chunk = payload['chunks'][0]
    assert chunk['filename'] == 'demo.txt'
    assert chunk['content'].startswith('示例内容')
    assert chunk['score'] > 0
    assert chunk['bm25_score'] is not None

    assistant_chunks = payload['assistant_message']['metadata']['chunks']
    assert len(assistant_chunks) == 1
    assert assistant_chunks[0]['vector_id'] == 42

    conversation_id = payload['conversation_id']
    detail = client.get(f'/api/chat/conversations/{conversation_id}')
    assert detail.status_code == 200
    detail_payload = detail.json()
    assert detail_payload['conversation']['message_count'] == 2
    assert len(detail_payload['messages']) == 2
    assert detail_payload['messages'][0]['role'] == 'user'
    assert detail_payload['messages'][1]['role'] == 'assistant'
