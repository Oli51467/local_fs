from pydantic import BaseModel
from typing import List, Optional, Dict, Any

class EmbeddingRequest(BaseModel):
    text: str
    
class EmbeddingResponse(BaseModel):
    text: str
    embedding: List[float]
    dimension: int

class SummaryModelConfig(BaseModel):
    source_id: str
    model_id: str
    api_model: str
    name: Optional[str] = None
    provider_name: Optional[str] = None
    api_key: Optional[str] = None
    api_key_setting: Optional[str] = None
    requires_api_key: Optional[bool] = True
    api_url: Optional[str] = None

class DocumentSummaryConfig(BaseModel):
    enabled: bool = False
    model: Optional[SummaryModelConfig] = None

class FileUploadRequest(BaseModel):
    file_path: str  # 相对于data文件夹的路径
    summary: Optional[DocumentSummaryConfig] = None

class FileUploadResponse(BaseModel):
    status: str
    message: str
    document_id: Optional[int] = None
    chunks_count: Optional[int] = None
    file_info: Optional[Dict[str, Any]] = None
