"""Shared text-related helpers for API modules."""

from __future__ import annotations

import re
from typing import Tuple

_THINK_TAG_PATTERN = re.compile(r"<think\b[^>]*>([\s\S]*?)</think>", re.IGNORECASE)


def strip_think_tags(text: str) -> Tuple[str, bool]:
    """Remove ``<think>`` blocks from *text* and report whether any were stripped.

    Args:
        text: Raw text that may contain reasoning segments wrapped in ``<think>`` tags.

    Returns:
        A tuple of ``(cleaned_text, removed)`` where ``cleaned_text`` has all ``<think>``
        sections removed and ``removed`` indicates whether anything changed.
    """
    if not text:
        return "", False
    cleaned, count = _THINK_TAG_PATTERN.subn("", text)
    return cleaned.strip(), count > 0


def prepare_summary_preview(text: str, limit: int = 20) -> str:
    """Generate a short preview that is safe for UI display.

    The helper strips ``<think>`` sections, keeps the last non-empty line, and trims the
    result so it fits within ``limit`` characters (default 20).
    """
    cleaned, _ = strip_think_tags(text or "")
    if not cleaned:
        return ""

    lines = [line.strip() for line in cleaned.splitlines() if line.strip()]
    candidate = lines[-1] if lines else cleaned.strip()
    if len(candidate) <= limit:
        return candidate
    return candidate[:limit]

