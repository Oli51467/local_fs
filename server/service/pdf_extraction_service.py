from __future__ import annotations

import copy
import json
import os
import shutil
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, List, Optional
import re

from PIL import Image

import magic_pdf.libs.config_reader as config_reader
from magic_pdf.config.enums import SupportedPdfParseMethod
from magic_pdf.config.make_content_config import MakeMode
from magic_pdf.data.data_reader_writer import FileBasedDataReader, FileBasedDataWriter
from magic_pdf.data.dataset import PymuDocDataset
from magic_pdf.model.doc_analyze_by_custom_model import doc_analyze

from config.mineru_config import MINERU_CONFIG, META_ROOT


ProgressCallback = Optional[Callable[[float, str], None]]


class PdfExtractionError(Exception):
    """Raised when MinerU PDF extraction fails."""


@dataclass
class PdfExtractionResult:
    markdown: str
    plain_text: str
    images: List[dict]
    temp_dir: Path


_IMAGE_EXTENSIONS = {'.png', '.jpg', '.jpeg', '.gif', '.tiff', '.bmp'}


def _resolve_model_path(relative_path: object) -> Optional[str]:
    if not relative_path:
        return None

    path_value = Path(str(relative_path))
    if path_value.is_absolute():
        return str(path_value)
    return str((META_ROOT / path_value).resolve())


def _prepare_runtime_config() -> Path:
    runtime_config = copy.deepcopy(MINERU_CONFIG)

    for key in ("models-dir", "layoutreader-model-dir"):
        if key in runtime_config:
            resolved = _resolve_model_path(runtime_config[key])
            if resolved:
                runtime_config[key] = resolved

    config_path = META_ROOT / "magic-pdf.offline.json"
    config_path.parent.mkdir(parents=True, exist_ok=True)
    config_path.write_text(
        json.dumps(runtime_config, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return config_path


def _apply_environment(config_path: Path) -> None:
    os.environ.setdefault("QTWEBENGINE_DISABLE_GPU", "1")
    os.environ.setdefault(
        "QTWEBENGINE_CHROMIUM_FLAGS", "--disable-gpu --disable-software-rasterizer"
    )
    os.environ.setdefault("QT_OPENGL", "software")

    os.environ["MINERU_TOOLS_CONFIG_JSON"] = str(config_path)
    config_reader.CONFIG_FILE_NAME = str(config_path)


def parse_pdf_document(
    pdf_path: Path,
    plain_text_converter: Optional[Callable[[str], str]] = None,
    progress_callback: ProgressCallback = None,
) -> PdfExtractionResult:
    """Parse a PDF file with MinerU, returning markdown, plain text, and image metadata."""

    if not pdf_path.exists() or not pdf_path.is_file():
        raise PdfExtractionError(f"PDF文件不存在: {pdf_path}")

    if progress_callback:
        progress_callback(0.05, "准备解析")

    config_path = _prepare_runtime_config()
    _apply_environment(config_path)

    temp_root = Path(tempfile.mkdtemp(prefix="mineru_pdf_"))
    images_dir = temp_root / "images"
    output_dir = temp_root / "output"
    images_dir.mkdir(parents=True, exist_ok=True)
    output_dir.mkdir(parents=True, exist_ok=True)

    if progress_callback:
        progress_callback(0.25, "准备解析")

    writer_markdown = FileBasedDataWriter(str(output_dir))
    writer_image = FileBasedDataWriter(str(images_dir))
    reader_pdf = FileBasedDataReader("")

    try:
        bytes_pdf = reader_pdf.read(str(pdf_path))
        dataset_pdf = PymuDocDataset(bytes_pdf)
        parse_method = dataset_pdf.classify()

        if progress_callback:
            progress_callback(0.45, "解析中")

        if parse_method == SupportedPdfParseMethod.OCR:
            infer_result = dataset_pdf.apply(doc_analyze, ocr=True)
            pipe_result = infer_result.pipe_ocr_mode(writer_image)
        else:
            infer_result = dataset_pdf.apply(doc_analyze, ocr=False)
            pipe_result = infer_result.pipe_txt_mode(writer_image)

        if progress_callback:
            progress_callback(0.65, "解析中")

        markdown_content = pipe_result.get_markdown(
            str(images_dir), md_make_mode=MakeMode.NLP_MD
        )

        if progress_callback:
            progress_callback(0.8, "整理结果中")

        if plain_text_converter is not None:
            plain_text = plain_text_converter(markdown_content)
        else:
            plain_text = markdown_content

        images: List[dict] = []
        for index, image_path in enumerate(sorted(images_dir.rglob('*'))):
            if not image_path.is_file():
                continue
            suffix = image_path.suffix.lower()
            if suffix not in _IMAGE_EXTENSIONS:
                continue

            try:
                stat_info = image_path.stat()
            except OSError:
                continue

            width = height = None
            try:
                with Image.open(image_path) as pil_image:
                    width, height = pil_image.size
            except Exception:
                width = height = None

            stem = image_path.stem
            line_number = None
            page_match = re.search(r'(?:page|p|pg)[-_]?(\d+)', stem, re.IGNORECASE)
            if page_match:
                try:
                    line_number = int(page_match.group(1))
                except ValueError:
                    line_number = None
            if line_number is None:
                generic_match = re.search(r'(\d+)', stem)
                if generic_match:
                    try:
                        line_number = int(generic_match.group(1))
                    except ValueError:
                        line_number = None

            images.append(
                {
                    "source_path": image_path,
                    "source_path_relative": None,
                    "line_number": line_number if line_number is not None else index + 1,
                    "chunk_index": index,
                    "alt_text": "",
                    "image_format": suffix.lstrip('.'),
                    "image_size": stat_info.st_size,
                    "width": width,
                    "height": height,
                    "temp_dir": temp_root,
                }
            )

        if progress_callback:
            progress_callback(0.92, "整理结果中")

        return PdfExtractionResult(
            markdown=markdown_content,
            plain_text=plain_text,
            images=images,
            temp_dir=temp_root,
        )
    except Exception as exc:  # pylint: disable=broad-except
        shutil.rmtree(temp_root, ignore_errors=True)
        raise PdfExtractionError(f"解析PDF失败: {exc}") from exc


def generate_pdf_markdown(
    pdf_path: Path,
    target_markdown_path: Path,
    plain_text_converter: Optional[Callable[[str], str]] = None,
    progress_callback: ProgressCallback = None,
) -> str:
    """Generate a Markdown file parsed from PDF and return the markdown content."""

    result = parse_pdf_document(pdf_path, plain_text_converter, progress_callback)
    try:
        if progress_callback:
            progress_callback(0.96, "整理结果中")
        target_markdown_path.parent.mkdir(parents=True, exist_ok=True)
        target_markdown_path.write_text(result.markdown, encoding="utf-8")
        if progress_callback:
            progress_callback(0.98, "整理结果中")
        return result.markdown
    finally:
        shutil.rmtree(result.temp_dir, ignore_errors=True)
