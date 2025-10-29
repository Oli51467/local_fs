"""
Memory management service integrating with the mem0 library.

This module encapsulates memory retrieval and persistence so that the chat
workflow can remain agnostic of the underlying implementation details.
"""

from __future__ import annotations

import logging
import os
from contextlib import contextmanager
from dataclasses import dataclass
from threading import Lock
from typing import Dict, List, Optional, Tuple

from config.config import DatabaseConfig

try:  # pragma: no cover - optional dependency guard
    from mem0 import Memory
    from mem0.client.main import MemoryClient
except ImportError:  # pragma: no cover - dependency missing
    Memory = None  # type: ignore
    MemoryClient = None  # type: ignore

try:  # pragma: no cover - optional dependency guard
    from openai import OpenAI
except ImportError:  # pragma: no cover - dependency missing
    OpenAI = None  # type: ignore

logger = logging.getLogger(__name__)

DEFAULT_MEMORY_LIMIT = 3
MAX_MEMORY_LIMIT = 10


@dataclass(frozen=True)
class MemoryRuntimeOptions:
    """Resolved runtime options for memory operations."""

    mem0_api_key: Optional[str]
    openai_api_key: Optional[str]
    user_id: str
    limit: int = DEFAULT_MEMORY_LIMIT

    @property
    def cache_key(self) -> Tuple[str, str]:
        return (self.mem0_api_key or "", self.openai_api_key or "")


class MemoryServiceError(RuntimeError):
    """Base error raised by the MemoryService."""


class MemoryValidationError(MemoryServiceError):
    """Raised when API key validation fails."""


class MemoryService:
    """Facade responsible for integrating mem0 into the chat workflow."""

    def __init__(self) -> None:
        if Memory is None:
            raise MemoryServiceError(
                "mem0 库未安装，无法启用记忆功能。请先安装 mem0ai 依赖。"
            )

        self._entries: Dict[Tuple[str, str], Dict[str, object]] = {}
        self._entries_lock = Lock()
        self._initialise_runtime_directory()

    def validate_keys(
        self,
        mem0_api_key: Optional[str],
        openai_api_key: Optional[str],
    ) -> Dict[str, object]:
        """Validate provided API keys and return per-provider results."""

        mem0_key = (mem0_api_key or "").strip()
        openai_key = (openai_api_key or "").strip()

        if not mem0_key and not openai_key:
            raise MemoryValidationError("请至少提供 Mem0 API Key 或 OpenAI API Key。")

        mem0_valid: Optional[bool] = None
        mem0_error: Optional[str] = None
        if mem0_key:
            if MemoryClient is None:  # pragma: no cover - dependency missing
                mem0_valid = False
                mem0_error = "mem0 依赖未安装。"
            else:
                try:
                    with self._override_env({"MEM0_API_KEY": mem0_key}):
                        MemoryClient(api_key=mem0_key)
                    mem0_valid = True
                except Exception as exc:  # pragma: no cover - network dependent
                    mem0_valid = False
                    mem0_error = str(exc)

        openai_valid: Optional[bool] = None
        openai_error: Optional[str] = None
        if openai_key:
            if OpenAI is None:  # pragma: no cover - dependency missing
                openai_valid = False
                openai_error = "openai 依赖未安装。"
            else:
                try:
                    client = OpenAI(api_key=openai_key)
                    client.models.list()  # minimal invocation
                    openai_valid = True
                except Exception as exc:  # pragma: no cover - network dependent
                    openai_valid = False
                    openai_error = str(exc)

        success = any(flag is True for flag in (mem0_valid, openai_valid))
        details: List[str] = []
        if mem0_valid is True:
            details.append("Mem0 API Key 验证成功。")
        elif mem0_valid is False:
            details.append(f"Mem0 API Key 验证失败：{mem0_error or '未知错误'}")

        if openai_valid is True:
            details.append("OpenAI API Key 验证成功。")
        elif openai_valid is False:
            details.append(f"OpenAI API Key 验证失败：{openai_error or '未知错误'}")

        if not details:
            details.append("未检测到可用的 API Key。")

        return {
            "success": success,
            "mem0_valid": mem0_valid,
            "openai_valid": openai_valid,
            "detail": " ".join(details),
        }

    def search_memories(
        self,
        options: MemoryRuntimeOptions,
        query: str,
    ) -> List[str]:
        """Search relevant memories for the provided query."""

        entry = self._get_or_create_entry(options)
        memory: Memory = entry["memory"]  # type: ignore[assignment]
        lock: Lock = entry["lock"]  # type: ignore[assignment]

        with lock:
            try:
                result = memory.search(
                    query=query,
                    user_id=options.user_id,
                    limit=options.limit,
                )
            except Exception as exc:  # pragma: no cover - defensive logging
                logger.debug("mem0 搜索失败: %s", exc, exc_info=True)
                return []

        items = result.get("results") if isinstance(result, dict) else None
        if not isinstance(items, list):
            return []

        memories: List[str] = []
        for item in items:
            if not isinstance(item, dict):
                continue
            memory_text = item.get("memory") or item.get("text")
            if isinstance(memory_text, str) and memory_text.strip():
                memories.append(memory_text.strip())
        return memories

    def add_memory(
        self,
        options: MemoryRuntimeOptions,
        messages: List[Dict[str, str]],
    ) -> None:
        """Persist new memories based on the latest interaction."""

        entry = self._get_or_create_entry(options)
        memory: Memory = entry["memory"]  # type: ignore[assignment]
        lock: Lock = entry["lock"]  # type: ignore[assignment]

        with lock:
            try:
                memory.add(messages, user_id=options.user_id)
            except Exception as exc:  # pragma: no cover - defensive logging
                logger.debug("mem0 写入失败: %s", exc, exc_info=True)

    def resolve_options(
        self,
        mem0_api_key: Optional[str],
        openai_api_key: Optional[str],
        user_id: Optional[str],
        limit: Optional[int] = None,
    ) -> MemoryRuntimeOptions:
        """Normalise user-provided values into runtime options."""

        uid = (user_id or "").strip() or "default_user"
        resolved_limit = limit if isinstance(limit, int) else DEFAULT_MEMORY_LIMIT
        resolved_limit = max(1, min(MAX_MEMORY_LIMIT, resolved_limit))

        return MemoryRuntimeOptions(
            mem0_api_key=(mem0_api_key or "").strip() or None,
            openai_api_key=(openai_api_key or "").strip() or None,
            user_id=uid,
            limit=resolved_limit,
        )

    def _get_or_create_entry(
        self,
        options: MemoryRuntimeOptions,
    ) -> Dict[str, object]:
        with self._entries_lock:
            cached = self._entries.get(options.cache_key)
            if cached is not None:
                return cached

            memory = self._instantiate_memory(options)
            entry = {"memory": memory, "lock": Lock()}
            self._entries[options.cache_key] = entry
            return entry

    def _instantiate_memory(self, options: MemoryRuntimeOptions) -> Memory:
        overrides = {}
        if options.mem0_api_key:
            overrides["MEM0_API_KEY"] = options.mem0_api_key
        if options.openai_api_key:
            overrides["OPENAI_API_KEY"] = options.openai_api_key

        with self._override_env(overrides):
            try:
                return Memory()
            except Exception as exc:  # pragma: no cover - dependency/runtime errors
                raise MemoryServiceError(f"初始化 mem0 失败: {exc}") from exc

    @staticmethod
    def _initialise_runtime_directory() -> None:
        try:
            default_dir = DatabaseConfig.DATABASE_DIR / "mem0"
            default_dir.mkdir(parents=True, exist_ok=True)
            os.environ.setdefault("MEM0_DIR", str(default_dir))
        except Exception as exc:  # pragma: no cover - filesystem guard
            logger.debug("初始化 mem0 数据目录失败: %s", exc, exc_info=True)

    @contextmanager
    def _override_env(self, overrides: Dict[str, str]):
        original: Dict[str, Optional[str]] = {}
        try:
            for key, value in overrides.items():
                original[key] = os.environ.get(key)
                os.environ[key] = value
            yield
        finally:
            for key, previous in original.items():
                if previous is None:
                    os.environ.pop(key, None)
                else:
                    os.environ[key] = previous


memory_service_instance: Optional[MemoryService] = None


def get_memory_service() -> MemoryService:
    global memory_service_instance
    if memory_service_instance is None:
        memory_service_instance = MemoryService()
    return memory_service_instance
