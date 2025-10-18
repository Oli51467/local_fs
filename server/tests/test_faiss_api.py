import sys
import types
from pathlib import Path
from typing import Any, Dict, List, Optional

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

if "FlagEmbedding" not in sys.modules:
    flag_module = types.ModuleType("FlagEmbedding")

    class _StubBGEM3:
        def __init__(self, *args, **kwargs) -> None:
            pass

        def encode(self, texts, **kwargs):
            size = len(texts)
            return {'dense_vecs': [[0.0, 0.0, 0.0, 0.0] for _ in range(size)]}

    class _StubReranker:
        def __init__(self, *args, **kwargs) -> None:
            pass

        def compute_score(self, content, normalize: bool = False):
            if not content:
                return []
            return [0.0 for _ in content]

    flag_module.BGEM3FlagModel = _StubBGEM3
    flag_module.FlagReranker = _StubReranker
    sys.modules["FlagEmbedding"] = flag_module

if "bm25s" not in sys.modules:
    bm25s_module = types.ModuleType("bm25s")

    class _StubBM25:
        def __init__(self, corpus):
            self.corpus = corpus

        def index(self, tokens):
            return None

        def retrieve(self, queries, k: int):
            if not queries:
                return [[]], [[]]
            return [[0] * k], [[0.0] * k]

    bm25s_module.BM25 = _StubBM25
    sys.modules["bm25s"] = bm25s_module

if "faiss" not in sys.modules:
    faiss_module = types.ModuleType("faiss")

    class _StubIndexFlatIP:
        def __init__(self, dimension: int) -> None:
            self.dimension = dimension
            self.ntotal = 0

        def add(self, vectors):
            self.ntotal += len(vectors)

        def search(self, vectors, k: int):
            import numpy as _np

            batch = len(vectors)
            return _np.zeros((batch, k), dtype=_np.float32), _np.full((batch, k), -1, dtype=_np.int64)

        def reconstruct(self, idx: int):
            return [0.0 for _ in range(self.dimension)]

        def reconstruct_n(self, start: int, count: int, output):
            return None

    def _normalize_L2(vectors):
        return None

    def _write_index(index, path):
        return None

    def _read_index(path):
        return _StubIndexFlatIP(4)

    faiss_module.IndexFlatIP = _StubIndexFlatIP
    faiss_module.normalize_L2 = _normalize_L2
    faiss_module.write_index = _write_index
    faiss_module.read_index = _read_index
    sys.modules["faiss"] = faiss_module

from server.api import faiss_api
from server.api.faiss_api import init_faiss_api, router as faiss_router


class FakeFaissManager:
    def __init__(self, metadata: List[Dict[str, Any]], results: List[List[Dict[str, Any]]]) -> None:
        self.metadata = metadata
        self._results = results
        self.dimension = 4
        self.index_path = Path("dummy_index.faiss")
        self.metadata_path = Path("dummy_meta.json")

    def search_vectors(self, query_vectors, k: int = 10):
        return self._results

    def get_total_vectors(self) -> int:
        return len(self.metadata)


class FakeImageFaissManager:
    def search_vectors(self, query_vectors, k: int = 10):
        return [[]]


class FakeEmbeddingService:
    def encode_text(self, text: str):
        return [0.1, 0.2, 0.3, 0.4]


class FakeBM25Service:
    def __init__(self, retrieve_results: List[Dict[str, Any]], score_results: List[float]) -> None:
        self._retrieve_results = retrieve_results
        self._score_results = score_results
        self._built_indices: List[List[Dict[str, Any]]] = []

    def is_available(self) -> bool:
        return True

    def retrieve(self, query: str, top_k: int = 50) -> List[Dict[str, Any]]:
        return self._retrieve_results[:top_k]

    def score_documents(self, query: str, documents: List[str]) -> List[float]:
        return self._score_results[: len(documents)]

    def build_index(self, documents: List[Dict[str, Any]]) -> bool:
        self._built_indices.append(documents)
        return True


class FakeRerankerService:
    def __init__(self, scores: List[float]) -> None:
        self._scores = scores

    def is_available(self) -> bool:
        return True

    def rerank_results(self, query: str, passages: List[str], normalize: bool = True) -> List[float]:
        return self._scores[: len(passages)]


class FakeSQLiteService:
    def __init__(
        self,
        allowed_vectors: Dict[int, Dict[str, Any]],
        known_docs: Dict[str, Dict[str, Any]],
        chunk_search_results: Optional[List[Dict[str, Any]]] = None,
    ) -> None:
        self._allowed_vectors = allowed_vectors
        self._known_docs = known_docs
        self._chunk_search_results = chunk_search_results or []

    def get_chunk_by_vector_id(self, vector_id: int) -> Optional[Dict[str, Any]]:
        record = self._allowed_vectors.get(vector_id)
        if record is None:
            return None
        return dict(record)

    def get_document_by_path(self, file_path: str) -> Optional[Dict[str, Any]]:
        document = self._known_docs.get(file_path)
        return dict(document) if document is not None else None

    def get_document_by_id(self, document_id: int) -> Optional[Dict[str, Any]]:
        for document in self._known_docs.values():
            if document.get('id') == document_id:
                return dict(document)
        return None

    def search_chunks_by_substring(self, query: str) -> List[Dict[str, Any]]:
        return [dict(item) for item in self._chunk_search_results]


def create_test_client(
    fake_faiss: FakeFaissManager,
    fake_embedding: FakeEmbeddingService,
    fake_image: FakeImageFaissManager,
    fake_bm25: FakeBM25Service,
    fake_reranker: FakeRerankerService,
    fake_sqlite: Optional[Any] = None,
) -> TestClient:
    app = FastAPI()
    init_faiss_api(fake_faiss, fake_embedding, fake_image, fake_bm25, fake_reranker, fake_sqlite)
    app.include_router(faiss_router)
    return TestClient(app)


def test_hybrid_text_search_merges_dense_lexical_and_rerank(monkeypatch):
    metadata = [
        {
            "vector_id": 0,
            "chunk_text": "Alpha 段落包含测试关键词。",
            "filename": "doc1.txt",
            "file_path": "docs/doc1.txt",
            "chunk_index": 0,
        },
        {
            "vector_id": 1,
            "chunk_text": "Beta 内容展示另一段文本。",
            "filename": "doc2.txt",
            "file_path": "docs/doc2.txt",
            "chunk_index": 0,
        },
    ]
    dense_results = [[
        {**metadata[0], "score": 0.82},
        {**metadata[1], "score": 0.57},
    ]]
    lexical_results = [
        {"doc_id": "1", "score": 3.4, "rank": 1, "content": metadata[1]["chunk_text"]},
        {"doc_id": "0", "score": 1.6, "rank": 2, "content": metadata[0]["chunk_text"]},
    ]
    bm25_scores = [1.6, 3.4]
    rerank_scores = [0.92, 0.35]

    def _raise_clip_service():
        raise RuntimeError("clip unavailable")
    monkeypatch.setattr(faiss_api, "get_clip_embedding_service", _raise_clip_service)

    client = create_test_client(
        FakeFaissManager(metadata, dense_results),
        FakeEmbeddingService(),
        FakeImageFaissManager(),
        FakeBM25Service(lexical_results, bm25_scores),
        FakeRerankerService(rerank_scores),
        None,
    )

    response = client.post(
        "/api/faiss/search",
        json={"query": "Alpha", "top_k": 2},
    )
    assert response.status_code == 200
    payload = response.json()

    assert payload["semantic_match"]["bm25s_performed"] is True
    assert payload["semantic_match"]["rerank_performed"] is True
    assert payload["semantic_match"]["clip_performed"] is False
    assert payload["image_match"]["total"] == 0

    semantic_results = payload["semantic_match"]["results"]
    assert semantic_results, "Expected semantic results"
    assert len(semantic_results) == 2

    top_result = semantic_results[0]
    assert top_result["filename"] == "doc1.txt"
    assert {"dense", "lexical", "reranker"} <= set(top_result["sources"])
    assert {"dense", "lexical", "reranker"} <= set((top_result.get("score_breakdown") or {}).keys())
    assert top_result["score_weights"]
    weights_sum = sum(top_result["score_weights"].values())
    assert pytest.approx(weights_sum, rel=1e-6) == 1.0

    second_result = semantic_results[1]
    assert second_result["filename"] == "doc2.txt"
    assert "lexical" in second_result["sources"]
    assert second_result["metrics"]["semantic"]["bm25s_score"] == pytest.approx(0.7727, rel=1e-3)

    combined_results = payload["combined"]["results"]
    assert any(item["source"] == "exact" for item in combined_results)
    assert any(item["source"] == "semantic" for item in combined_results)

    semantic_entry = next(item for item in combined_results if item["source"] == "semantic")
    assert semantic_entry["final_score"] >= 0.3
    assert semantic_entry["filename"] == "doc2.txt"
    assert semantic_entry["metrics"]["semantic"]["embedding_score"] == pytest.approx(0.57)

def test_exact_match_returns_all_chunks(monkeypatch):
    metadata: List[Dict[str, Any]] = []
    dense_results = [[]]
    lexical_results: List[Dict[str, Any]] = []
    bm25_scores: List[float] = []
    rerank_scores: List[float] = []

    def _raise_clip_service():
        raise RuntimeError('clip unavailable')

    monkeypatch.setattr(faiss_api, 'get_clip_embedding_service', _raise_clip_service)

    chunk_search_results = [
        {
            'chunk_id': 7001,
            'document_id': 201,
            'chunk_index': 0,
            'content': 'Alpha first paragraph',
            'vector_id': 10,
            'filename': 'docA.txt',
            'file_path': 'docs/docA.txt',
            'file_type': 'text/plain',
            'upload_time': '2024-01-02T00:00:00',
        },
        {
            'chunk_id': 7002,
            'document_id': 202,
            'chunk_index': 1,
            'content': 'Second Alpha paragraph',
            'vector_id': 11,
            'filename': 'docB.txt',
            'file_path': 'docs/docB.txt',
            'file_type': 'text/plain',
            'upload_time': '2024-01-03T00:00:00',
        },
    ]

    client = create_test_client(
        FakeFaissManager(metadata, dense_results),
        FakeEmbeddingService(),
        FakeImageFaissManager(),
        FakeBM25Service(lexical_results, bm25_scores),
        FakeRerankerService(rerank_scores),
        FakeSQLiteService({}, {}, chunk_search_results),
    )

    response = client.post(
        '/api/faiss/search',
        json={'query': 'Alpha', 'top_k': 1},
    )
    assert response.status_code == 200
    payload = response.json()

    exact_results = payload['exact_match']['results']
    assert len(exact_results) == 2
    filenames = {item['filename'] for item in exact_results}
    assert filenames == {'docA.txt', 'docB.txt'}

    combined_results = payload['combined']['results']
    exact_count = sum(1 for item in combined_results if item['source'] == 'exact')
    assert exact_count == 2


def test_unregistered_documents_are_excluded(monkeypatch):
    metadata = [
        {
            "vector_id": 0,
            "chunk_text": "Alpha 段落包含测试关键词。",
            "filename": "doc1.txt",
            "file_path": "docs/doc1.txt",
            "chunk_index": 0,
        },
        {
            "vector_id": 1,
            "chunk_text": "Beta 内容展示另一段文本。",
            "filename": "doc2.txt",
            "file_path": "docs/doc2.txt",
            "chunk_index": 0,
        },
    ]

    dense_results = [[
        {**metadata[0], "score": 0.91},
        {**metadata[1], "score": 0.88},
    ]]

    lexical_results = [
        {"doc_id": "0", "score": 3.2, "rank": 1, "content": metadata[0]["chunk_text"]},
        {"doc_id": "1", "score": 2.7, "rank": 2, "content": metadata[1]["chunk_text"]},
    ]

    bm25_scores = [3.2, 2.7]
    rerank_scores = [0.95, 0.6]

    def _raise_clip_service():
        raise RuntimeError("clip unavailable")

    monkeypatch.setattr(faiss_api, "get_clip_embedding_service", _raise_clip_service)

    allowed_vectors = {
        0: {
            "document_id": 101,
            "filename": "doc1.txt",
            "file_path": "docs/doc1.txt",
            "file_type": "text/plain",
            "chunk_index": 0,
            "content": metadata[0]["chunk_text"],
            "vector_id": 0,
        }
    }

    known_docs = {
        "docs/doc1.txt": {
            "id": 101,
            "filename": "doc1.txt",
            "file_path": "docs/doc1.txt",
            "file_type": "text/plain",
            "file_size": 1234,
            "upload_time": "2024-01-01T00:00:00",
            "file_hash": "hash1",
            "total_chunks": 1,
        }
    }

    chunk_search_results = [
        {
            "chunk_id": 5001,
            "document_id": 101,
            "chunk_index": 0,
            "content": metadata[0]["chunk_text"],
            "vector_id": 0,
            "filename": "doc1.txt",
            "file_path": "docs/doc1.txt",
            "file_type": "text/plain",
            "upload_time": "2024-01-01T00:00:00",
        }
    ]

    client = create_test_client(
        FakeFaissManager(metadata, dense_results),
        FakeEmbeddingService(),
        FakeImageFaissManager(),
        FakeBM25Service(lexical_results, bm25_scores),
        FakeRerankerService(rerank_scores),
        FakeSQLiteService(allowed_vectors, known_docs, chunk_search_results),
    )

    response = client.post(
        "/api/faiss/search",
        json={"query": "Alpha", "top_k": 3},
    )
    assert response.status_code == 200
    payload = response.json()

    exact_results = payload["exact_match"]["results"]
    assert len(exact_results) == 1
    assert exact_results[0]["filename"] == "doc1.txt"

    semantic_results = payload["semantic_match"]["results"]
    assert len(semantic_results) == 1
    assert semantic_results[0]["filename"] == "doc1.txt"

    combined_results = payload["combined"]["results"]
    assert all(entry["filename"] == "doc1.txt" for entry in combined_results)
