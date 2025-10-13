from unittest import mock

import pytest

pytest.importorskip("fastapi")
from fastapi.testclient import TestClient

from server.main import app
from server.service.model_download_service import ModelStatus


class DummyService:
    def __init__(self) -> None:
        self.status = ModelStatus(
            key="demo",
            name="Demo Model",
            description="",
            tags=["test"],
            repo_id="example/demo",
            local_path="/tmp/demo",
            status="not_downloaded",
            progress=0.0,
            downloaded_bytes=0,
            total_bytes=None,
            message=None,
            error=None,
            endpoint=None,
            updated_at=0.0,
        )

    def list_statuses(self):  # type: ignore[no-untyped-def]
        return [self.status]

    def get_status(self, key: str):  # type: ignore[no-untyped-def]
        if key != self.status.key:
            raise KeyError(key)
        return self.status

    def start_download(self, key: str):  # type: ignore[no-untyped-def]
        if key != self.status.key:
            raise KeyError(key)
        self.status = ModelStatus(
            key="demo",
            name="Demo Model",
            description="",
            tags=["test"],
            repo_id="example/demo",
            local_path="/tmp/demo",
            status="downloading",
            progress=0.2,
            downloaded_bytes=1,
            total_bytes=5,
            message="downloading",
            error=None,
            endpoint="https://huggingface.co",
            updated_at=1.0,
        )
        return self.status


client = TestClient(app)


def test_list_models_returns_status() -> None:
    service = DummyService()
    with mock.patch("server.api.model_api.get_model_download_service", return_value=service):
        response = client.get("/api/models")
    assert response.status_code == 200
    data = response.json()
    assert data[0]["key"] == "demo"
    assert data[0]["status"] == "not_downloaded"


def test_start_download_invokes_service() -> None:
    service = DummyService()
    with mock.patch("server.api.model_api.get_model_download_service", return_value=service):
        response = client.post("/api/models/demo/download")
    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "downloading"
    assert payload["progress"] == 0.2
    assert payload["endpoint"] == "https://huggingface.co"
