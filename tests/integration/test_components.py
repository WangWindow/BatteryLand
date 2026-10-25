from fastapi.testclient import TestClient

from batteryland.common.errors import DomainError


def test_real_component_preview_upload_and_checkpoint_round_trip(client: TestClient) -> None:
    catalog = client.get("/api/v1/components")
    assert catalog.status_code == 200
    model = next(
        item
        for item in catalog.json()["data"]
        if item["scope"] == "model" and item["type"] == "cpmlp"
    )
    assert model["id"] and model["source_hash"]
    content = b"from core.register.registryhub import R\n@R.model.register('NewModel')\nclass Model: pass\n"
    uploaded = client.post(
        "/api/v1/components/uploads",
        data={"scope": "model"},
        files={"file": ("model.py", content, "text/x-python")},
    )
    assert uploaded.status_code == 201
    assert uploaded.json()["data"]["activation"] == "next_experiment"
    assert uploaded.json()["data"]["components"][0]["type"] == "newmodel"
    checkpoint = client.post(
        "/api/v1/checkpoints",
        data={"component_id": model["id"]},
        files={"file": ("weights.pth", b"opaque-model-bytes", "application/octet-stream")},
    )
    assert checkpoint.status_code == 201
    artifact = checkpoint.json()["data"]
    assert artifact["kind"] == "checkpoint" and artifact["experiment_id"] is None
    downloaded = client.get(f"/api/v1/artifacts/{artifact['id']}/download")
    assert downloaded.content == b"opaque-model-bytes"
    assert client.get("/api/v1/checkpoints").json()["data"]["total"] == 1


def test_unsupported_upload_is_rejected_when_provider_is_unavailable(
    client: TestClient, monkeypatch
) -> None:
    provider = client.app.state.container.provider
    original = provider._control

    def unavailable_catalog(operation, arguments):
        if operation == "catalog":
            raise DomainError("provider_unavailable", "Simulated missing training dependency")
        return original(operation, arguments)

    monkeypatch.setattr(provider, "_control", unavailable_catalog)
    assert client.get("/api/v1/components/model/cpmlp/schema").status_code == 503
    assert client.get("/api/v1/capabilities").status_code == 404
    failure = client.post(
        "/api/v1/components/uploads",
        data={"scope": "model"},
        files={"file": ("../escape.py", b"print('bad')")},
    )
    assert failure.status_code == 422
