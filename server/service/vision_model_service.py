from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Sequence


@dataclass(frozen=True)
class VisionAttachment:
    """Normalized representation of an uploaded vision attachment."""

    data_url: str
    mime_type: Optional[str] = None
    name: Optional[str] = None


class VisionModelAdapter:
    """Base adapter for vision-capable language models."""

    def __init__(self, model_ids: Sequence[str]) -> None:
        self._model_ids = {item.lower() for item in model_ids}

    def supports(self, model_id: str) -> bool:
        return (model_id or "").strip().lower() in self._model_ids

    def build_test_messages(self, prompt: str) -> List[Dict[str, Any]]:
        raise NotImplementedError

    def apply_attachments(
        self, messages: List[Dict[str, Any]], attachments: Sequence[VisionAttachment]
    ) -> List[Dict[str, Any]]:
        raise NotImplementedError


class DashScopeVisionAdapter(VisionModelAdapter):
    """Adapter for DashScope vision-capable chat models."""

    SAMPLE_IMAGE_URL = (
        "https://img.alicdn.com/imgextra/i1/"
        "O1CN01gDEY8M1W114Hi3XcN_!!6000000002727-0-tps-1024-406.jpg"
    )

    DEFAULT_PROMPT = "这道题怎么解答？"

    def __init__(self) -> None:
        super().__init__(
            [
                "qwen3-vl-plus",
                "qwen3-vl-flash",
                "qwen-vl-plus",
                "qwen-vl-max",
                "qvq-max",
                "qvq-72b-preview",
            ]
        )

    def build_test_messages(self, prompt: str) -> List[Dict[str, Any]]:
        sanitized_prompt = prompt or self.DEFAULT_PROMPT
        return [
            {
                "role": "user",
                "content": [
                    {
                        "type": "image_url",
                        "image_url": {"url": self.SAMPLE_IMAGE_URL},
                    },
                    {"type": "text", "text": sanitized_prompt},
                ],
            }
        ]

    def apply_attachments(
        self, messages: List[Dict[str, Any]], attachments: Sequence[VisionAttachment]
    ) -> List[Dict[str, Any]]:
        if not attachments:
            return [dict(message) for message in messages]

        processed: List[Dict[str, Any]] = []
        last_user_index = None

        for index in range(len(messages) - 1, -1, -1):
            message = messages[index]
            if isinstance(message, dict) and message.get("role") == "user":
                last_user_index = index
                break

        for idx, message in enumerate(messages):
            cloned = dict(message)
            if idx == last_user_index:
                content_blocks: List[Dict[str, Any]] = []
                original_content = cloned.get("content")
                if isinstance(original_content, list):
                    content_blocks.extend(original_content)
                elif original_content:
                    content_blocks.append(
                        {"type": "text", "text": str(original_content)}
                    )
                else:
                    content_blocks.append({"type": "text", "text": ""})

                for attachment in attachments:
                    image_payload: Dict[str, Any] = {
                        "type": "image_url",
                        "image_url": {"url": attachment.data_url},
                    }
                    if attachment.mime_type:
                        image_payload["image_url"]["mime_type"] = attachment.mime_type
                    content_blocks.append(image_payload)

                cloned["content"] = content_blocks
            processed.append(cloned)

        return processed


_VISION_HANDLERS: List[VisionModelAdapter] = [DashScopeVisionAdapter()]


def get_vision_handler(model_id: str) -> Optional[VisionModelAdapter]:
    for handler in _VISION_HANDLERS:
        if handler.supports(model_id):
            return handler
    return None
