from pathlib import Path
from types import SimpleNamespace
from unittest import mock
import sys
import time

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))
SERVER_ROOT = REPO_ROOT / "server"
if str(SERVER_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVER_ROOT))

from server.service.model_download_service import ModelDownloadService
from server.service.model_manager import ModelManager, ModelSpec


def _mock_repo_info(filename: str, size: int = 4) -> SimpleNamespace:
    return SimpleNamespace(siblings=[SimpleNamespace(rfilename=filename, size=size)])


def _fake_snapshot_download(**kwargs):  # type: ignore[no-untyped-def]
    target = Path(kwargs["local_dir"])
    target.mkdir(parents=True, exist_ok=True)
    (target / "config.json").write_text("{}", encoding="utf-8")
    return str(target)


def test_start_download_updates_status(tmp_path: Path) -> None:
    registry = {
        "demo": ModelSpec(
            key="demo",
            repo_id="example/demo",
            local_subdir=Path("demo"),
            required_files=(
                "config.json",
            ),
            display_name="测试模型",
            description="用于单元测试",
            tags=("测试",),
        )
    }
    manager = ModelManager(registry, meta_root=tmp_path)
    service = ModelDownloadService(manager)

    with mock.patch("huggingface_hub.HfApi") as api_cls, mock.patch(
        "huggingface_hub.snapshot_download",
        side_effect=_fake_snapshot_download,
    ):
        api_instance = api_cls.return_value
        api_instance.repo_info.return_value = _mock_repo_info("config.json")

        status = service.start_download("demo")
        assert status.key == "demo"
        assert status.name == "测试模型"

        # Wait for asynchronous download to finish
        for _ in range(20):
            status = service.get_status("demo")
            if status.status == "downloaded":
                break
            time.sleep(0.05)

    final_status = service.get_status("demo")
    assert final_status.status == "downloaded"
    assert final_status.progress == 1.0
    assert final_status.downloaded_bytes > 0
    assert (tmp_path / "demo" / "config.json").exists()


def test_ensure_download_and_get_path_reuses_existing(tmp_path: Path) -> None:
    registry = {
        "demo": ModelSpec(
            key="demo",
            repo_id="example/demo",
            local_subdir=Path("demo"),
            required_files=(
                "config.json",
            ),
        )
    }
    manager = ModelManager(registry, meta_root=tmp_path)
    service = ModelDownloadService(manager)

    target_dir = tmp_path / "demo"
    target_dir.mkdir(parents=True, exist_ok=True)
    (target_dir / "config.json").write_text("{}", encoding="utf-8")

    path = service.ensure_download_and_get_path("demo")
    assert path == target_dir
    status = service.get_status("demo")
    assert status.status == "downloaded"
    assert status.progress == 1.0
