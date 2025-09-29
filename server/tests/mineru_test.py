"""Minimal MinerU demo: parse `data/test.pdf` and write outputs to `data/`."""
from __future__ import annotations

import json
import logging
from pathlib import Path

LOGGER = logging.getLogger(__name__)
PROJECT_ROOT = Path(__file__).resolve().parents[2]
PDF_PATH = PROJECT_ROOT / "data" / "test.pdf"
OUTPUT_DIR = PROJECT_ROOT / "data"


def _import_mineru():
    """Return a MinerU-compatible class from the installed package."""

    candidates: tuple[tuple[str, tuple[str, ...]], ...] = (
        ("mineru", ("MinerU", "MagicPDF", "MagicPdf", "Miner")),
        ("magic_pdf", ("MinerU", "MagicPDF", "MagicPdf")),
    )

    last_exc: Exception | None = None

    for module_name, attr_names in candidates:
        try:
            module = __import__(module_name, fromlist=["*"])  # type: ignore
        except ImportError as exc:
            last_exc = exc
            continue

        for attr in attr_names:
            if hasattr(module, attr):
                LOGGER.debug("Using %s.%s", module_name, attr)
                return getattr(module, attr)

        last_exc = AttributeError(
            f"Module '{module_name}' does not expose any of {attr_names}"
        )

    raise SystemExit(
        "Could not locate a MinerU-compatible class. Ensure either the 'mineru'"
        " or 'magic-pdf' package is installed and up to date."
    ) from last_exc


class MinerUExtractor:
    """Lightweight wrapper around the MinerU PDF parser."""

    def __init__(self, model_root: Path | None = None) -> None:
        MinerU = _import_mineru()
        kwargs = {"model_root": str(model_root)} if model_root else {}
        LOGGER.info("Initialising MinerU with args: %s", kwargs or "default")
        self._runtime = MinerU(**kwargs)

    def parse_pdf(self, pdf_path: Path) -> dict | str | bytes:
        LOGGER.info("Parsing PDF: %s", pdf_path)

        if hasattr(self._runtime, "predict"):
            return self._runtime.predict(pdf_path=str(pdf_path))
        if callable(self._runtime):
            return self._runtime(str(pdf_path))
        raise RuntimeError("Unexpected MinerU interface; expected 'predict' or callable instance")

    @staticmethod
    def _write_payload(path: Path, payload: str | bytes) -> None:
        if isinstance(payload, bytes):
            path.write_bytes(payload)
        else:
            path.write_text(payload, encoding="utf-8")

    def export_results(self, result: dict | str | bytes, pdf_path: Path, output_dir: Path) -> None:
        output_dir.mkdir(parents=True, exist_ok=True)
        stem = pdf_path.stem

        if isinstance(result, dict):
            json_path = output_dir / f"{stem}_mineru.json"
            json_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
            LOGGER.info("Full MinerU payload written to %s", json_path)

            markdown = result.get("markdown") or result.get("md")
            text = result.get("text")

            if markdown:
                md_path = output_dir / f"{stem}_mineru.md"
                self._write_payload(md_path, markdown)
                LOGGER.info("Markdown saved to %s", md_path)
            if text:
                txt_path = output_dir / f"{stem}_mineru.txt"
                self._write_payload(txt_path, text)
                LOGGER.info("Plain text saved to %s", txt_path)
        else:
            md_path = output_dir / f"{stem}_mineru.md"
            self._write_payload(md_path, result)
            LOGGER.info("Markdown saved to %s", md_path)


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="[%(levelname)s] %(message)s")

    if not PDF_PATH.exists():
        LOGGER.error("PDF file not found: %s", PDF_PATH)
        return 1

    extractor = MinerUExtractor()
    result = extractor.parse_pdf(PDF_PATH)
    extractor.export_results(result, PDF_PATH, OUTPUT_DIR)
    LOGGER.info("MinerU demo finished")
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
