from __future__ import annotations

from typing import List, Literal, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from openai import OpenAI

from service.model_download_service import (
    ModelDownloadService,
    ModelStatus as ServiceModelStatus,
    get_model_download_service,
)


MODELSCOPE_BASE_URL = "https://api-inference.modelscope.cn/v1/"
DASHSCOPE_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1"


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


class ModelScopeTestRequest(BaseModel):
    api_key: str = Field(..., description="ModelScope Access Token")
    model: str = Field(
        default="Qwen/Qwen3-32B",
        description="需要测试调用的模型 ID（默认 Qwen/Qwen3-32B）",
    )
    prompt: str = Field(
        default="你好，如果你能够正常工作，请回复我“你好”。",
        description="用于连通性测试的用户消息",
    )


class ModelScopeTestResponse(BaseModel):
    success: bool = Field(default=True, description="调用是否成功")
    model: str = Field(..., description="实际调用的模型 ID")
    content: Optional[str] = Field(default=None, description="模型返回的内容")


@router.post("/test-modelscope", response_model=ModelScopeTestResponse)
def test_modelscope_connection(
    payload: ModelScopeTestRequest,
) -> ModelScopeTestResponse:
    api_key = (payload.api_key or "").strip()
    if not api_key:
        raise HTTPException(status_code=400, detail="缺少 ModelScope API Key")

    model_id = (payload.model or "").strip() or "Qwen/Qwen3-32B"
    prompt = payload.prompt.strip() or "你好，如果你能够正常工作，请回复我“你好”。"

    client = OpenAI(api_key=api_key, base_url=MODELSCOPE_BASE_URL)
    try:
        stream = client.chat.completions.create(
            model=model_id,
            messages=[
                {"role": "system", "content": "You are a helpful assistant."},
                {"role": "user", "content": prompt},
            ],
            stream=True,
            max_tokens=64,
            extra_body={
                "enable_thinking": True,
                "thinking_budget": 40960,
            },
        )
    except Exception as exc:  # pylint: disable=broad-except
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    content_parts: List[str] = []
    thinking_parts: List[str] = []
    try:
        for chunk in stream:
            if not chunk or not chunk.choices:
                continue
            choice = chunk.choices[0]
            delta = getattr(choice, "delta", None)
            if delta is None:
                continue
            reasoning = getattr(delta, "reasoning_content", None)
            if reasoning:
                thinking_parts.append(str(reasoning))
            piece = getattr(delta, "content", None)
            if piece:
                content_parts.append(str(piece))
    except Exception:  # pylint: disable=broad-except
        pass

    content_text = "".join(content_parts).strip()
    thinking_text = "".join(thinking_parts).strip()
    if thinking_text and content_text:
        combined = f"{thinking_text}\n\n=== Final Answer ===\n{content_text}"
    else:
        combined = content_text or thinking_text or ""

    return ModelScopeTestResponse(
        success=True, model=model_id, content=combined or None
    )


class DashScopeTestRequest(BaseModel):
    api_key: str = Field(..., description="DashScope API Key")
    model: str = Field(
        default="qwen3-max",
        description="需要测试调用的模型 ID（默认 qwen3-max）",
    )
    prompt: str = Field(
        default="你好，如果你能够正常工作，请回复我“你好”。",
        description="用于连通性测试的用户消息",
    )


class DashScopeTestResponse(BaseModel):
    success: bool = Field(default=True, description="调用是否成功")
    model: str = Field(..., description="实际调用的模型 ID")
    content: Optional[str] = Field(default=None, description="模型返回的内容")


@router.post("/test-dashscope", response_model=DashScopeTestResponse)
def test_dashscope_connection(payload: DashScopeTestRequest) -> DashScopeTestResponse:
    api_key = (payload.api_key or "").strip()
    if not api_key:
        raise HTTPException(status_code=400, detail="缺少 DashScope API Key")

    model_id = (payload.model or "").strip() or "qwen3-max"
    prompt = payload.prompt.strip() or "你好，如果你能够正常工作，请回复我“你好”。"

    client = OpenAI(api_key=api_key, base_url=DASHSCOPE_BASE_URL)
    try:
        stream = client.chat.completions.create(
            model=model_id,
            messages=[
                {"role": "system", "content": "You are a helpful assistant."},
                {"role": "user", "content": prompt},
            ],
            stream=True,
            max_tokens=64,
            extra_body={
                "enable_thinking": True,
                "thinking_budget": 40960,
            },
        )
    except Exception as exc:  # pylint: disable=broad-except
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    chunks: List[str] = []
    try:
        for chunk in stream:
            if not chunk or not chunk.choices:
                continue
            choice = chunk.choices[0]
            delta = getattr(choice, "delta", None)
            if delta and getattr(delta, "content", None):
                chunks.append(str(delta.content))
            message = getattr(choice, "message", None)
            if message and getattr(message, "content", None):
                chunks.append(str(message.content))
    except Exception:  # pylint: disable=broad-except
        pass

    content_text = "".join(chunks).strip() or None
    return DashScopeTestResponse(success=True, model=model_id, content=content_text)
