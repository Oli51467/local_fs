import copy
import json
import os
import random
import re
import string
import sys
from pathlib import Path

os.environ.setdefault("QTWEBENGINE_DISABLE_GPU", "1")
os.environ.setdefault(
    "QTWEBENGINE_CHROMIUM_FLAGS", "--disable-gpu --disable-software-rasterizer"
)
os.environ.setdefault("QT_OPENGL", "software")

import magic_pdf.libs.config_reader as config_reader
from magic_pdf.config.enums import SupportedPdfParseMethod
from magic_pdf.config.make_content_config import MakeMode
from magic_pdf.data.data_reader_writer import FileBasedDataWriter, FileBasedDataReader
from magic_pdf.data.dataset import PymuDocDataset
from magic_pdf.model.doc_analyze_by_custom_model import doc_analyze

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from server.config.mineru_config import MINERU_CONFIG


def _write_runtime_config(repo_root: Path) -> Path:
    """Materialise the MinerU config with repo-relative paths."""

    meta_root = repo_root / "meta" / "pdf-extract-kit"
    runtime_config = copy.deepcopy(MINERU_CONFIG)

    def _resolve(value: object) -> str | None:
        if not value:
            return None
        path_value = Path(str(value))
        if path_value.is_absolute():
            return str(path_value)
        return str((meta_root / path_value).resolve())

    for path_key in ("models-dir", "layoutreader-model-dir"):
        if path_key in runtime_config:
            runtime_config[path_key] = _resolve(runtime_config[path_key])

    config_path = meta_root / "magic-pdf.offline.json"
    config_path.parent.mkdir(parents=True, exist_ok=True)
    config_path.write_text(
        json.dumps(runtime_config, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return config_path


def markdown_to_plain_text(markdown_text: str) -> str:
    text = markdown_text
    text = re.sub(r"^---[\s\S]*?---\s*", "", text, flags=re.MULTILINE)
    text = re.sub(r"```[\s\S]*?```", "\n", text)
    text = re.sub(r"`([^`]+)`", r"\1", text)
    text = re.sub(r"!\[([^\]]*)\]\([^\)]+\)", r"\1", text)
    text = re.sub(r"\[([^\]]+)\]\([^\)]+\)", r"\1", text)
    text = re.sub(r"^#{1,6}\s*", "", text, flags=re.MULTILINE)
    text = re.sub(r">\s?", "", text)
    text = re.sub(r"\*\*([^*]+)\*\*", r"\1", text)
    text = re.sub(r"__([^_]+)__", r"\1", text)
    text = re.sub(r"\*([^*]+)\*", r"\1", text)
    text = re.sub(r"_([^_]+)_", r"\1", text)
    text = re.sub(r"~~([^~]+)~~", r"\1", text)
    text = re.sub(r"(?m)^\s*[-*+]\s+", "", text)
    text = re.sub(r"(?m)^\s*\d+\.\s+", "", text)
    text = re.sub(r"\s+\n", "\n", text)
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


# --------------------------
# 主程序
# --------------------------
if __name__ == "__main__":
    repo_root = REPO_ROOT
    pdf_file_path = repo_root / "data" / "xuan_通用运动机器人_202405230055 -English_xu.pdf"
    models_root = repo_root / "meta" / "pdf-extract-kit"
    models_dir = models_root / "models"
    config_path = _write_runtime_config(repo_root)

    if not pdf_file_path.exists():
        raise FileNotFoundError(f"未找到测试PDF文件: {pdf_file_path}")
    if not models_dir.exists():
        raise FileNotFoundError(f"未找到本地pdf-extract-kit模型目录: {models_dir}")

    # 告知magic-pdf使用meta目录下提供的配置
    os.environ["MINERU_TOOLS_CONFIG_JSON"] = str(config_path)
    config_reader.CONFIG_FILE_NAME = str(config_path)

    pdf_stem = pdf_file_path.stem
    pdf_dir = pdf_file_path.parent
    suffix = "".join(
        random.choices(string.ascii_lowercase + string.digits, k=6)
    )
    output_dir = pdf_dir / f"{pdf_stem}_{suffix}"
    images_dir = output_dir / "images"
    output_dir.mkdir(parents=True, exist_ok=True)
    images_dir.mkdir(parents=True, exist_ok=True)

    writer_markdown = FileBasedDataWriter(str(output_dir))
    writer_image = FileBasedDataWriter(str(images_dir))
    reader_pdf = FileBasedDataReader("")

    bytes_pdf = reader_pdf.read(str(pdf_file_path))
    dataset_pdf = PymuDocDataset(bytes_pdf)

    if dataset_pdf.classify() == SupportedPdfParseMethod.OCR:
        infer_result = dataset_pdf.apply(doc_analyze, ocr=True)
        pipe_result = infer_result.pipe_ocr_mode(writer_image)
    else:
        infer_result = dataset_pdf.apply(doc_analyze, ocr=False)
        pipe_result = infer_result.pipe_txt_mode(writer_image)

    model_inference_result = infer_result.get_infer_res()
    print("模型处理结果:", model_inference_result)

    markdown_content = pipe_result.get_markdown(
        str(images_dir), md_make_mode=MakeMode.NLP_MD
    )
    print("Markdown内容:", markdown_content)
    pipe_result.dump_md(
        writer_markdown,
        f"{pdf_stem}.md",
        str(images_dir),
        md_make_mode=MakeMode.NLP_MD,
    )

    plain_text = markdown_to_plain_text(markdown_content)
    writer_markdown.write_string(f"{pdf_stem}.txt", plain_text)
