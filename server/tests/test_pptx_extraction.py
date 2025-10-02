"""Tests for PPTX extraction pipeline."""

from __future__ import annotations

import shutil
import sys
from pathlib import Path

import pytest

_pptx_module = pytest.importorskip("pptx")
from pptx import Presentation


PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from server.api.document_api import extract_text_and_images
from server.service.pptx_extraction_service import extract_pptx_text_and_images


SAMPLE_PPTX = PROJECT_ROOT / "data" / "文档" / "副本DeepSeek部署方案_20250407.pptx"


@pytest.mark.skipif(not SAMPLE_PPTX.exists(), reason="Sample PPTX document is missing")
def test_pptx_extraction_returns_slide_aligned_text_and_images():
    result = extract_pptx_text_and_images(SAMPLE_PPTX)
    try:
        assert result.text, "Expected non-empty aggregated text from PPTX"

        presentation = Presentation(str(SAMPLE_PPTX))
        slide_headers = [
            line for line in result.text.splitlines() if line.startswith("第") and "页" in line
        ]
        assert len(slide_headers) == len(presentation.slides)

        if result.images:
            line_numbers = [image["line_number"] for image in result.images]
            assert line_numbers == sorted(line_numbers), "Images should follow slide order"
    finally:
        if result.temp_dir:
            shutil.rmtree(result.temp_dir, ignore_errors=True)


@pytest.mark.skipif(not SAMPLE_PPTX.exists(), reason="Sample PPTX document is missing")
def test_api_extract_text_and_images_includes_cleanup_paths():
    text, images, cleanup_dirs = extract_text_and_images(SAMPLE_PPTX, "pptx")
    try:
        assert text.startswith("第"), "Slide headers should be present in extracted text"
        assert cleanup_dirs, "Expected temp directory for extracted PPTX images"
        if images:
            assert all("image_format" in image for image in images)
    finally:
        for path in cleanup_dirs:
            shutil.rmtree(path, ignore_errors=True)
