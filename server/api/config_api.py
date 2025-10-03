from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, model_validator

from config.config import (
    get_retrieval_config,
    get_default_retrieval_config,
    reset_server_config,
    update_server_config,
)


router = APIRouter(prefix="/api/config", tags=["config"])


class RetrievalSettings(BaseModel):
    recursive_chunk_size: int = Field(..., ge=0, le=2000)
    recursive_chunk_overlap: int = Field(..., ge=0, le=500)
    bm25s_weight: float = Field(..., ge=0.0, le=1.0)
    embedding_weight: float = Field(..., ge=0.0, le=1.0)

    @model_validator(mode='after')
    def validate_constraints(cls, model):  # pylint: disable=no-self-argument
        chunk_size = model.recursive_chunk_size
        chunk_overlap = model.recursive_chunk_overlap
        if chunk_overlap > chunk_size:
            raise ValueError('recursive_chunk_overlap cannot exceed recursive_chunk_size')

        total_weight = model.bm25s_weight + model.embedding_weight
        if total_weight <= 0:
            raise ValueError('At least one of bm25s_weight or embedding_weight must be greater than 0')

        return model


def _to_response_model(snapshot: dict) -> RetrievalSettings:
    return RetrievalSettings(
        recursive_chunk_size=snapshot['RECURSIVE_CHUNK_SIZE'],
        recursive_chunk_overlap=snapshot['RECURSIVE_CHUNK_OVERLAP'],
        bm25s_weight=snapshot['BM25S_WEIGHT'],
        embedding_weight=snapshot['EMBEDDING_WEIGHT'],
    )


@router.get('/retrieval', response_model=RetrievalSettings)
async def get_retrieval_settings() -> RetrievalSettings:
    """获取检索相关配置。"""
    snapshot = get_retrieval_config()
    return _to_response_model(snapshot)


@router.get('/retrieval/defaults', response_model=RetrievalSettings)
async def get_retrieval_defaults() -> RetrievalSettings:
    """获取检索配置默认值。"""
    snapshot = get_default_retrieval_config()
    return _to_response_model(snapshot)


@router.put('/retrieval', response_model=RetrievalSettings)
async def update_retrieval_settings(payload: RetrievalSettings) -> RetrievalSettings:
    """更新检索相关配置。"""
    try:
        snapshot = update_server_config({
            'RECURSIVE_CHUNK_SIZE': payload.recursive_chunk_size,
            'RECURSIVE_CHUNK_OVERLAP': payload.recursive_chunk_overlap,
            'BM25S_WEIGHT': payload.bm25s_weight,
            'EMBEDDING_WEIGHT': payload.embedding_weight,
        })
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error

    return _to_response_model(snapshot)


@router.post('/retrieval/reset', response_model=RetrievalSettings)
async def reset_retrieval_settings() -> RetrievalSettings:
    """恢复检索配置为默认值。"""
    snapshot = reset_server_config()
    return _to_response_model(snapshot)
