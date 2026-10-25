import sys
from dataclasses import replace

from fastapi.testclient import TestClient

from batteryland.api.app import create_app


def test_api_and_static_components_work_when_training_environment_is_missing(settings, tmp_path):
    settings = replace(settings, training_python=tmp_path / "absent/bin/python")
    with TestClient(create_app(settings, start_monitor=False, legacy_writes=True)) as client:
        assert client.get("/api/v1/data-sources").status_code == 200
        assert client.get("/api/v1/components").status_code == 200
        failure = client.get("/api/v1/components/model/cpmlp/schema")
        assert failure.status_code == 503
        assert failure.json()["data"]["error"] == "provider_unavailable"
        capabilities = client.get("/api/v1/capabilities").json()["data"]
        assert (
            next(item for item in capabilities if item["provider_id"] == "deeplatform")["available"]
            is False
        )
        assert client.get("/api/v1/data-sources").status_code == 200
        assert "torch" not in sys.modules
