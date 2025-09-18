from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Optional
import logging
from service.embedding_service import get_embedding_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/document", tags=["document"])

class EmbeddingRequest(BaseModel):
    text: str
    
class EmbeddingResponse(BaseModel):
    text: str
    embedding: List[float]
    dimension: int

@router.post("/test", response_model=EmbeddingResponse)
async def test_embedding(request: EmbeddingRequest):
    """
    测试BGE-M3模型的向量化功能
    """
    try:
        logger.info(f"开始处理文本向量化请求: {request.text[:50]}...")
        
        # 获取embedding服务
        embedding_service = get_embedding_service()
        
        # 进行向量化
        embedding = embedding_service.encode_text(request.text)
        
        logger.info(f"向量化完成，维度: {len(embedding)}")
        
        return EmbeddingResponse(
            text=request.text,
            embedding=embedding,
            dimension=len(embedding)
        )
        
    except Exception as e:
        logger.error(f"向量化处理失败: {str(e)}")
        raise HTTPException(status_code=500, detail=f"向量化处理失败: {str(e)}")

@router.get("/test")
async def test_embedding_get():
    """
    GET方式测试BGE-M3模型的向量化功能
    """
    try:
        test_text = "这是一个测试文本，用于验证BGE-M3模型的向量化功能。"
        
        logger.info(f"开始处理测试文本向量化: {test_text}")
        
        # 获取embedding服务
        embedding_service = get_embedding_service()
        
        # 进行向量化
        embedding = embedding_service.encode_text(test_text)
        
        logger.info(f"向量化完成，维度: {len(embedding)}")
        
        return {
            "message": "BGE-M3向量化测试成功",
            "text": test_text,
            "embedding_dimension": len(embedding),
            "embedding_sample": embedding[:5],  # 只返回前5个维度作为示例
            "status": "success"
        }
        
    except Exception as e:
        logger.error(f"向量化测试失败: {str(e)}")
        raise HTTPException(status_code=500, detail=f"向量化测试失败: {str(e)}")