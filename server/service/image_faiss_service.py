import json
import logging
from pathlib import Path
from typing import Dict, List, Optional

import faiss
import numpy as np

from config.config import DatabaseConfig

logger = logging.getLogger(__name__)


class ImageFaissManager:
    """Faiss manager dedicated to image embeddings."""

    def __init__(self, dimension: int = 512) -> None:
        self.dimension = dimension
        self.index_path: Path = DatabaseConfig.IMAGE_VECTOR_INDEX_PATH
        self.metadata_path: Path = DatabaseConfig.IMAGE_VECTOR_METADATA_PATH
        self.index: Optional[faiss.Index] = None
        self.metadata: List[Dict] = []
        self.next_vector_id = 0
        DatabaseConfig.ensure_directories()
        self._init_index()

    def _init_index(self) -> None:
        if self.index_path.exists():
            self.index = faiss.read_index(str(self.index_path))
            if self.metadata_path.exists():
                with open(self.metadata_path, "r", encoding="utf-8") as handle:
                    self.metadata = json.load(handle)
            else:
                self.metadata = []
        else:
            self.index = faiss.IndexFlatIP(self.dimension)
            self.metadata = []
            self.save_index()

        self.next_vector_id = self._compute_next_vector_id()

    def _compute_next_vector_id(self) -> int:
        if not self.metadata:
            return 0
        try:
            return max(int(entry.get("vector_id", -1)) for entry in self.metadata) + 1
        except ValueError:
            return 0

    def save_index(self) -> None:
        if self.index is None:
            return
        faiss.write_index(self.index, str(self.index_path))
        with open(self.metadata_path, "w", encoding="utf-8") as handle:
            json.dump(self.metadata, handle, ensure_ascii=False, indent=2)

    def add_vectors(self, vectors: np.ndarray, metadata_list: List[Dict]) -> List[int]:
        if self.index is None:
            raise RuntimeError("Faiss index is not initialized")
        if vectors.ndim != 2:
            raise ValueError("Expected 2D array for vectors")
        if vectors.shape[1] != self.dimension:
            raise ValueError(f"向量维度不匹配，期望 {self.dimension}，实际 {vectors.shape[1]}")
        if len(metadata_list) != vectors.shape[0]:
            raise ValueError("Metadata list length must match number of vectors")

        faiss.normalize_L2(vectors)
        start_id = self.next_vector_id
        self.index.add(vectors)

        vector_ids: List[int] = []
        for offset, metadata in enumerate(metadata_list):
            vector_id = start_id + offset
            self.metadata.append({"vector_id": vector_id, **metadata})
            vector_ids.append(vector_id)

        self.next_vector_id = start_id + len(vector_ids)
        self.save_index()
        return vector_ids

    def add_vector(self, vector: List[float], metadata: Dict) -> int:
        array = np.array([vector], dtype=np.float32)
        vector_ids = self.add_vectors(array, [metadata])
        return vector_ids[0]

    def search_vectors(self, query_vectors: np.ndarray, k: int = 10) -> List[List[Dict]]:
        if self.index is None:
            raise RuntimeError("Faiss index is not initialized")
        if query_vectors.ndim != 2:
            raise ValueError("Expected 2D array for query vectors")
        if query_vectors.shape[1] != self.dimension:
            raise ValueError(f"向量维度不匹配，期望 {self.dimension}，实际 {query_vectors.shape[1]}")

        faiss.normalize_L2(query_vectors)
        distances, indices = self.index.search(query_vectors, k)

        all_results: List[List[Dict]] = []
        for row_idx, row in enumerate(indices):
            results: List[Dict] = []
            for col_idx, vector_index in enumerate(row):
                if vector_index == -1:
                    continue
                if vector_index >= len(self.metadata):
                    continue
                metadata_entry = self.metadata[vector_index].copy()
                metadata_entry['score'] = float(distances[row_idx][col_idx])
                results.append(metadata_entry)
            all_results.append(results)
        return all_results

    def delete_vectors_by_ids(self, vector_ids: List[int]) -> int:
        if not vector_ids:
            return 0
        if self.index is None:
            return 0

        vector_id_set = {int(v) for v in vector_ids}
        current_count = self.index.ntotal
        if current_count == 0:
            return 0

        all_vectors = np.zeros((current_count, self.dimension), dtype=np.float32)
        self.index.reconstruct_n(0, current_count, all_vectors)

        new_index = faiss.IndexFlatIP(self.dimension)
        new_metadata: List[Dict] = []
        deleted_count = 0

        for i in range(current_count):
            metadata_entry: Optional[Dict] = None
            if i < len(self.metadata):
                metadata_entry = self.metadata[i]

            meta_vector_id = None
            if metadata_entry is not None:
                meta_vector_id = metadata_entry.get("vector_id")
                if meta_vector_id is not None:
                    meta_vector_id = int(meta_vector_id)

            identifier = meta_vector_id if meta_vector_id is not None else i

            if identifier in vector_id_set:
                deleted_count += 1
                continue

            vector = all_vectors[i : i + 1]
            new_index.add(vector)
            if metadata_entry is not None:
                new_metadata.append(metadata_entry)

        self.index = new_index
        self.metadata = new_metadata
        self.save_index()
        self._init_index()

        logger.info(
            "Image Faiss向量删除完成: 删除了 %d 个向量，剩余 %d 个向量",
            deleted_count,
            new_index.ntotal,
        )
        return deleted_count

    def get_total_vectors(self) -> int:
        return self.index.ntotal if self.index is not None else 0

    def update_metadata_by_path(self, old_path: str, new_path: str) -> int:
        updated = 0
        for metadata in self.metadata:
            if metadata.get("file_path") == old_path:
                metadata["file_path"] = new_path
                updated += 1
        if updated:
            self.save_index()
            logger.info(
                "更新图片Faiss元数据路径: %s -> %s，更新 %d 条",
                old_path,
                new_path,
                updated,
            )
        return updated

    def update_metadata_by_path_prefix(self, old_prefix: str, new_prefix: str) -> int:
        updated = 0
        for metadata in self.metadata:
            path = metadata.get("file_path")
            if path and path.startswith(old_prefix):
                metadata["file_path"] = path.replace(old_prefix, new_prefix, 1)
                updated += 1
        if updated:
            self.save_index()
            logger.info(
                "批量更新图片Faiss元数据路径: %s -> %s，更新 %d 条",
                old_prefix,
                new_prefix,
                updated,
            )
        return updated
