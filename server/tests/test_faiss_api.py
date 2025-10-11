from pathlib import Path
from typing import Any, Dict, List

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

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


def create_test_client(
    fake_faiss: FakeFaissManager,
    fake_embedding: FakeEmbeddingService,
    fake_image: FakeImageFaissManager,
    fake_bm25: FakeBM25Service,
    fake_reranker: FakeRerankerService,
) -> TestClient:
    app = FastAPI()
    init_faiss_api(fake_faiss, fake_embedding, fake_image, fake_bm25, fake_reranker)
    app.include_router(faiss_router)
    return TestClient(app)


def test_hybrid_text_search_merges_dense_lexical_and_rerank():
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

    client = create_test_client(
        FakeFaissManager(metadata, dense_results),
        FakeEmbeddingService(),
        FakeImageFaissManager(),
        FakeBM25Service(lexical_results, bm25_scores),
        FakeRerankerService(rerank_scores),
    )

    response = client.post(
        "/api/faiss/search",
        json={"query": "Alpha", "top_k": 2},
    )
    assert response.status_code == 200
    payload = response.json()

    assert payload["semantic_match"]["bm25s_performed"] is True
    assert payload["semantic_match"]["rerank_performed"] is True
    assert payload["image_match"]["total"] == 0

    semantic_results = payload["semantic_match"]["results"]
    assert semantic_results, "Expected semantic results"
    assert len(semantic_results) == 1
    top_result = semantic_results[0]

    assert top_result["filename"] == "doc1.txt"
    assert set(top_result["sources"]) == {"dense", "lexical", "reranker"}
    assert top_result["score_breakdown"]
    assert {"dense", "lexical", "reranker"} <= set(top_result["score_breakdown"].keys())
    assert top_result["score_weights"]
    weights_sum = sum(top_result["score_weights"].values())
    assert pytest.approx(weights_sum, rel=1e-6) == 1.0

    combined_results = payload["combined"]["results"]
    assert any(item["source"] == "exact" for item in combined_results)
    assert any(item["source"] == "semantic" for item in combined_results)

    semantic_entry = next(item for item in combined_results if item["source"] == "semantic")
    assert semantic_entry["final_score"] >= 0.3
    assert semantic_entry["metrics"]["semantic"]["embedding_score"] == pytest.approx(0.82)
