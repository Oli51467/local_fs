from pydantic import BaseModel
from typing import Optional

class SearchRequest(BaseModel):
    query: str
    top_k: int = 10
    bm25s_weight: Optional[float] = None  # 可选的BM25S权重，如果不提供则使用配置默认值
    embedding_weight: Optional[float] = None  # 可选的向量权重，如果不提供则使用配置默认值