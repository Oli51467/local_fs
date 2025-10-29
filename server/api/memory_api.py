import logging
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from service.memory_service import (
    MemoryService,
    MemoryServiceError,
    MemoryValidationError,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/memory", tags=["memory"])

memory_service: Optional[MemoryService] = None


class MemoryValidationRequest(BaseModel):
    mem0_api_key: Optional[str] = Field(default=None, alias="mem0_api_key")
    openai_api_key: Optional[str] = Field(default=None, alias="openai_api_key")

    class Config:  # pylint: disable=too-few-public-methods
        populate_by_name = True


class MemoryValidationResponse(BaseModel):
    success: bool
    detail: str
    mem0_valid: Optional[bool] = None
    openai_valid: Optional[bool] = None


def init_memory_api(service: Optional[MemoryService] = None) -> None:
    global memory_service
    memory_service = service


@router.post("/validate", response_model=MemoryValidationResponse)
async def validate_memory_keys(
    payload: MemoryValidationRequest,
) -> MemoryValidationResponse:
    if memory_service is None:
        raise HTTPException(status_code=503, detail="Memory service is not ready")

    try:
        result = memory_service.validate_keys(
            payload.mem0_api_key,
            payload.openai_api_key,
        )
    except MemoryValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except MemoryServiceError as exc:
        logger.warning("Memory validation failed: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return MemoryValidationResponse(**result)
