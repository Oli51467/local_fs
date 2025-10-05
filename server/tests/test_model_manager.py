from pathlib import Path
from unittest import mock
import sys

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))
SERVER_ROOT = REPO_ROOT / "server"
if str(SERVER_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVER_ROOT))

from server.service.model_manager import ModelManager, ModelSpec


def test_ensure_base_directories(tmp_path: Path) -> None:
    registry = {
        "demo": ModelSpec(
            key="demo",
            repo_id="example/demo",
            local_subdir=Path("demo"),
            required_files=("config.json",),
        )
    }
    manager = ModelManager(registry, meta_root=tmp_path)

    manager.ensure_base_directories()

    assert (tmp_path / "demo").exists()


def test_download_triggers_when_missing(tmp_path: Path) -> None:
    registry = {
        "demo": ModelSpec(
            key="demo",
            repo_id="example/demo",
            local_subdir=Path("demo"),
            required_files=("config.json",),
        )
    }
    manager = ModelManager(registry, meta_root=tmp_path)

    def _fake_snapshot_download(**kwargs):  # type: ignore[no-untyped-def]
        target = Path(kwargs["local_dir"])
        target.mkdir(parents=True, exist_ok=True)
        (target / "config.json").write_text("{}", encoding="utf-8")
        return str(target)

    with mock.patch("huggingface_hub.snapshot_download", side_effect=_fake_snapshot_download) as downloader:
        path = manager.get_model_path("demo", download=True)

    assert (path / "config.json").exists()
    downloader.assert_called_once()


def test_get_model_path_without_download(tmp_path: Path) -> None:
    registry = {
        "demo": ModelSpec(
            key="demo",
            repo_id="example/demo",
            local_subdir=Path("demo"),
            required_files=("config.json",),
        )
    }
    manager = ModelManager(registry, meta_root=tmp_path)

    try:
        manager.get_model_path("demo", download=False)
    except FileNotFoundError:
        pass
    else:  # pragma: no cover
        raise AssertionError("Expected FileNotFoundError when model is missing")
