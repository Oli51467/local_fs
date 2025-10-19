from __future__ import annotations

from typing import List, Literal, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from service.model_download_service import (
    ModelDownloadService,
    ModelStatus as ServiceModelStatus,
    get_model_download_service,
)


router = APIRouter(prefix="/api/models", tags=["models"])


class ModelStatusResponse(BaseModel):
    key: str
    name: str
    description: str
    tags: List[str] = Field(default_factory=list)
    repo_id: str
    local_path: str
    status: Literal["not_downloaded", "downloading", "downloaded", "failed"]
    progress: float = Field(ge=0.0, le=1.0)
    downloaded_bytes: int = Field(ge=0)
    total_bytes: Optional[int] = Field(default=None, ge=0)
    message: Optional[str] = None
    error: Optional[str] = None
    endpoint: Optional[str] = None
    updated_at: float

    @classmethod
    def from_service(cls, status: ServiceModelStatus) -> "ModelStatusResponse":
        return cls(**status.to_dict())


def _get_service() -> ModelDownloadService:
    return get_model_download_service()


@router.get("", response_model=List[ModelStatusResponse])
def list_models() -> List[ModelStatusResponse]:
    service = _get_service()
    return [ModelStatusResponse.from_service(item) for item in service.list_statuses()]


@router.get("/{key}", response_model=ModelStatusResponse)
def get_model_status(key: str) -> ModelStatusResponse:
    service = _get_service()
    try:
        status = service.get_status(key)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return ModelStatusResponse.from_service(status)


@router.post("/{key}/download", response_model=ModelStatusResponse)
def trigger_download(key: str) -> ModelStatusResponse:
    service = _get_service()
    try:
        status = service.start_download(key)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return ModelStatusResponse.from_service(status)


@router.post("/{key}/uninstall", response_model=ModelStatusResponse)
def uninstall_model(key: str) -> ModelStatusResponse:
    """Uninstall a system model and return its updated status."""
    service = _get_service()
    try:
        status = service.uninstall(key)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return ModelStatusResponse.from_service(status)
