from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional

import requests
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from openai import OpenAI
from requests.exceptions import RequestException

from service.model_download_service import (
    ModelDownloadService,
    ModelStatus as ServiceModelStatus,
    get_model_download_service,
)
from service.vision_model_service import get_vision_handler


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


def _coerce_openai_content(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: List[str] = []
        for item in content:
            if isinstance(item, str):
                parts.append(item)
                continue
            item_type = item.get("type") if isinstance(item, dict) else getattr(item, "type", None)
            text_value = item.get("text") if isinstance(item, dict) else getattr(item, "text", None)
            if item_type == "text" and text_value:
                parts.append(str(text_value))
        return "".join(parts)
    text_attr = getattr(content, "text", None)
    if text_attr and getattr(content, "type", "text") == "text":
        return str(text_attr)
    return str(content or "")


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
    handler = get_vision_handler(model_id)
    if handler:
        messages = handler.build_test_messages(prompt)
        thinking_budget = 81920
    else:
        messages = [
            {"role": "system", "content": "You are a helpful assistant."},
            {"role": "user", "content": prompt},
        ]
        thinking_budget = 40960
    try:
        stream = client.chat.completions.create(
            model=model_id,
            messages=messages,
            stream=True,
            max_tokens=64,
            extra_body={
                "enable_thinking": True,
                "thinking_budget": thinking_budget,
            },
        )
    except Exception as exc:  # pylint: disable=broad-except
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    reasoning_parts: List[str] = []
    answer_parts: List[str] = []

    def _append_piece(piece: Any) -> None:
        if piece is None:
            return
        reasoning_value = getattr(piece, "reasoning_content", None)
        if reasoning_value is None:
            reasoning_value = getattr(piece, "reasoning", None)
        if reasoning_value:
            if isinstance(reasoning_value, (list, tuple)):
                reasoning_parts.append(
                    "".join(str(item) for item in reasoning_value if item is not None)
                )
            else:
                reasoning_parts.append(str(reasoning_value))
        content_value = getattr(piece, "content", None)
        if content_value:
            text_value = _coerce_openai_content(content_value)
            if text_value:
                answer_parts.append(text_value)

    try:
        for chunk in stream:
            if not chunk or not chunk.choices:
                continue
            choice = chunk.choices[0]
            delta = getattr(choice, "delta", None)
            message = getattr(choice, "message", None)
            if delta is not None:
                _append_piece(delta)
            elif message is not None:
                _append_piece(message)
    except Exception:  # pylint: disable=broad-except
        pass

    reasoning_text = "".join(reasoning_parts).strip()
    content_text = "".join(answer_parts).strip()
    if reasoning_text and content_text:
        combined = f"{reasoning_text}\n\n=== Final Answer ===\n{content_text}"
    else:
        combined = content_text or reasoning_text or ""

    return DashScopeTestResponse(success=True, model=model_id, content=combined or None)


class DashScopeModelsRequest(BaseModel):
    api_key: str = Field(..., description="DashScope API Key")


class DashScopeModelItem(BaseModel):
    id: str = Field(..., description="模型唯一标识")
    display_name: Optional[str] = Field(default=None, description="模型展示名称")
    description: Optional[str] = Field(default=None, description="模型简介")
    metadata: Optional[Dict[str, Any]] = Field(default=None, description="模型附加信息")


class DashScopeModelsResponse(BaseModel):
    models: List[DashScopeModelItem] = Field(default_factory=list, description="可用模型列表")


@router.post("/dashscope/models", response_model=DashScopeModelsResponse)
def list_dashscope_models(payload: DashScopeModelsRequest) -> DashScopeModelsResponse:
    api_key = (payload.api_key or "").strip()
    if not api_key:
        raise HTTPException(status_code=400, detail="缺少 DashScope API Key")

    endpoint = f"{DASHSCOPE_BASE_URL.rstrip('/')}/models"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Accept": "application/json",
    }

    try:
        response = requests.get(endpoint, headers=headers, timeout=15)
    except RequestException as exc:  # pragma: no cover - network failure
        raise HTTPException(status_code=502, detail=f"请求 DashScope 失败: {exc}") from exc

    if response.status_code == 401:
        raise HTTPException(status_code=401, detail="DashScope API Key 无效或已过期")

    if response.status_code >= 500:
        raise HTTPException(status_code=502, detail="DashScope 服务暂时不可用，请稍后重试")

    if response.status_code >= 400:
        detail = response.text or f"HTTP {response.status_code}"
        raise HTTPException(status_code=response.status_code, detail=detail)

    try:
        data = response.json()
    except ValueError as exc:  # pragma: no cover - unexpected payload
        raise HTTPException(status_code=502, detail="DashScope 响应解析失败") from exc

    raw_models = data.get("data") or data.get("models") or []
    items: List[DashScopeModelItem] = []

    for entry in raw_models:
        if isinstance(entry, str):
            items.append(DashScopeModelItem(id=entry, display_name=entry))
        elif isinstance(entry, dict):
            item_id = entry.get("id") or entry.get("model_id") or entry.get("modelId") or entry.get("name")
            if not item_id:
                continue
            description = entry.get("description")
            metadata = entry.get("metadata")
            if not description and isinstance(metadata, dict):
                description = metadata.get("description")
            items.append(
                DashScopeModelItem(
                    id=str(item_id),
                    display_name=entry.get("display_name") or entry.get("name") or str(item_id),
                    description=description,
                    metadata=metadata if isinstance(metadata, dict) else None,
                )
            )

    return DashScopeModelsResponse(models=items)
