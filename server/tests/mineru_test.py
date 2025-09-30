import copy
import json
import os
import sys
from pathlib import Path
from tempfile import TemporaryDirectory

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


# --------------------------
# 主程序
# --------------------------
if __name__ == "__main__":
    repo_root = REPO_ROOT
    pdf_file_path = repo_root / "data" / "test.pdf"
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

    # 初始化数据读写器，仅保留最终 Markdown
    writer_markdown = FileBasedDataWriter(str(pdf_dir))
    reader_pdf = FileBasedDataReader("")

    with TemporaryDirectory(prefix="mineru_images_") as temp_image_dir:
        writer_image = FileBasedDataWriter(temp_image_dir)

        # 读取PDF文件
        bytes_pdf = reader_pdf.read(str(pdf_file_path))
        dataset_pdf = PymuDocDataset(bytes_pdf)

        # 处理数据（使用本地模型）
        if dataset_pdf.classify() == SupportedPdfParseMethod.OCR:
            infer_result = dataset_pdf.apply(doc_analyze, ocr=True)
            pipe_result = infer_result.pipe_ocr_mode(writer_image)
        else:
            infer_result = dataset_pdf.apply(doc_analyze, ocr=False)
            pipe_result = infer_result.pipe_txt_mode(writer_image)

        # 获取模型处理后的结果
        model_inference_result = infer_result.get_infer_res()
        print("模型处理结果:", model_inference_result)

        # 仅获取并保存Markdown内容
        markdown_content = pipe_result.get_markdown(
            temp_image_dir, md_make_mode=MakeMode.NLP_MD
        )
        print("Markdown内容:", markdown_content)
        pipe_result.dump_md(
            writer_markdown,
            f"{pdf_stem}.md",
            temp_image_dir,
            md_make_mode=MakeMode.NLP_MD,
        )
