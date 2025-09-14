from typing import Optional
from pydantic import BaseModel


class SearchRequest(BaseModel):
    """搜索请求模型"""
    query: str
    search_type: str = "hybrid"  # "text", "semantic", "hybrid"
    top_k: int = 10


class DocumentResponse(BaseModel):
    """文档响应模型"""
    document_id: int
    filename: str
    file_type: str
    total_chunks: int
    message: str


class SearchResult(BaseModel):
    """搜索结果模型"""
    document_id: int
    filename: str
    file_path: str
    file_type: str
    chunk_index: int
    content: str
    similarity_score: Optional[float] = None
    search_type: str