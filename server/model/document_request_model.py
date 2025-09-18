from pydantic import BaseModel
from typing import List, Optional, Dict, Any

class EmbeddingRequest(BaseModel):
    text: str
    
class EmbeddingResponse(BaseModel):
    text: str
    embedding: List[float]
    dimension: int

class FileUploadRequest(BaseModel):
    file_path: str  # 相对于data文件夹的路径

class FileUploadResponse(BaseModel):
    status: str
    message: str
    document_id: Optional[int] = None
    chunks_count: Optional[int] = None
    file_info: Optional[Dict[str, Any]] = None