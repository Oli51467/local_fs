"""Default MinerU configuration template.

Paths are derived from the repository root so the configuration remains
portable across machines.
"""

from __future__ import annotations

from pathlib import Path


# 项目根目录以及关键资源目录
PROJECT_ROOT = Path(__file__).resolve().parents[2]
META_ROOT = PROJECT_ROOT / "meta" / "pdf-extract-kit"
MODELS_DIR = META_ROOT / "models"
LAYOUTREADER_DIR = MODELS_DIR / "LayoutReader"


MINERU_CONFIG: dict[str, object] = {
    "models-dir": str(MODELS_DIR),
    "layoutreader-model-dir": str(LAYOUTREADER_DIR),
    "device-mode": "cpu",
    "layout-config": {"model": "doclayout_yolo"},
    "formula-config": {
        "enable": False,
        "mfd_model": "yolo_v8_mfd",
        "mfr_model": "unimernet_small",
    },
    "table-config": {"enable": False},
    "llm-aided-config": {"enable": False},
    "latex-delimiter-config": {
        "display": {"left": "$$", "right": "$$"},
        "inline": {"left": "$", "right": "$"},
    },
}
