"""Text splitting service – thin wrapper around LangChain's recursive splitter."""
from __future__ import annotations

import logging
from typing import List, Optional

from langchain.text_splitter import RecursiveCharacterTextSplitter

LOGGER = logging.getLogger(__name__)


class TextSplitterService:
    """Reusable text splitter based on RecursiveCharacterTextSplitter."""

    def __init__(
        self,
        splitter_type: str = "recursive",
        *,
        chunk_size: int = 300,
        chunk_overlap: int = 80,
        separators: Optional[List[str]] = None,
        **_: object,
    ) -> None:
        """Initialise the splitter service.

        ``splitter_type`` is retained for backwards compatibility. Any value
        other than ``"recursive"`` triggers a warning and falls back to the
        recursive splitter.
        """

        if splitter_type != "recursive":
            LOGGER.warning(
                "SemanticChunker support has been removed. Falling back to the"
                " recursive text splitter."
            )

        self.splitter_type = "recursive"
        self.chunk_size = chunk_size
        self.chunk_overlap = chunk_overlap
        self.separators = separators or ["\n\n", "\n", " ", ""]

        self.splitter = RecursiveCharacterTextSplitter(
            chunk_size=self.chunk_size,
            chunk_overlap=self.chunk_overlap,
            separators=self.separators,
            length_function=len,
        )

        LOGGER.info(
            "Initialised recursive splitter (chunk_size=%s, overlap=%s)",
            self.chunk_size,
            self.chunk_overlap,
        )

    def split_text(self, text: str) -> List[str]:
        if not text or not text.strip():
            return []

        try:
            chunks = self.splitter.split_text(text)
            LOGGER.info(
                "Text split complete: original_length=%s, chunks=%s",
                len(text),
                len(chunks),
            )
            return chunks
        except Exception as exc:  # pylint: disable=broad-except
            LOGGER.error("Text splitting failed: %s", exc)
            return [text] if text.strip() else []

    def get_splitter_info(self) -> dict:
        return {
            "type": self.splitter_type,
            "splitter_class": self.splitter.__class__.__name__,
        }


_text_splitter_service: Optional[TextSplitterService] = None


def init_text_splitter_service(splitter_type: str = "recursive", **kwargs) -> None:
    global _text_splitter_service
    _text_splitter_service = TextSplitterService(splitter_type, **kwargs)
    LOGGER.info("Text splitter service initialised (%s)", splitter_type)


def get_text_splitter_service() -> TextSplitterService:
    global _text_splitter_service
    if _text_splitter_service is None:
        raise RuntimeError("Text splitter service has not been initialised")
    return _text_splitter_service


def split_text(text: str) -> List[str]:
    return get_text_splitter_service().split_text(text)
