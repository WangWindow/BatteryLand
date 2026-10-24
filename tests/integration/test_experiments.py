from fastapi.testclient import TestClient


def native(device: str = "cpu", label: str = "demo") -> dict:
    return {"mate": {"seed": 42, "experiment": label, "device": device}, "task": {"type": "MyTask"}}


def test_templates_and_drafts_keep_versions_and_enforce_revisions(client: TestClient) -> None:
    created = client.post("/api/v1/templates", json={"name": "base", "native_config": native()})
    assert created.status_code == 201
    template = created.json()["data"]
    draft = client.post(
        "/api/v1/experiments",
        json={"name": "first", "bindings": {"template": {"id": template["id"], "version": 1}}},
    )
    assert draft.status_code == 201
    experiment = draft.json()["data"]
    assert experiment["native_config"] == native()
    update = client.put(
        f"/api/v1/templates/{template['id']}",
        json={"name": "base", "native_config": native(label="changed"), "expected_revision": 1},
    )
    assert update.json()["data"]["head_version"] == 2
    assert (
        client.get(f"/api/v1/experiments/{experiment['id']}").json()["data"]["native_config"]
        == native()
    )
    endpoint = f"/api/v1/experiments/{experiment['id']}"
    body = {"name": "renamed", "expected_revision": 1}
    assert client.patch(endpoint, json=body).json()["data"]["revision"] == 2
    assert client.patch(endpoint, json=body).status_code == 409
    assert client.delete(f"/api/v1/templates/{template['id']}").status_code == 409


def test_query_copy_export_and_device_validation(client: TestClient) -> None:
    created = client.post(
        "/api/v1/experiments", json={"name": "test", "native_config": native("auto")}
    )
    assert created.status_code == 201
    experiment = created.json()["data"]
    validation = client.post(f"/api/v1/experiments/{experiment['id']}/validate")
    assert validation.status_code == 200
    assert validation.json()["data"]["valid"] is False
    assert validation.json()["data"]["errors"][0]["error"] == "unsupported_device"
    page = client.get(
        "/api/v1/experiments", params={"task_type": "MyTask", "requested_device": "auto"}
    ).json()["data"]
    assert page["total"] == 1
    copied = client.post(
        f"/api/v1/experiments/{experiment['id']}/copy", json={"name": "copy"}
    ).json()["data"]
    assert copied["id"] != experiment["id"] and copied["state"] == "draft"
    assert copied["native_config"] == native("auto")
    assert "device: auto" in client.get(f"/api/v1/experiments/{copied['id']}/export").text


def test_safe_import_rejects_duplicate_fields_and_external_tags(client: TestClient) -> None:
    for content in [
        b"name: first\nname: overwritten\n",
        b'!!python/object/apply:os.system ["touch /tmp/not-allowed"]',
    ]:
        response = client.post(
            "/api/v1/templates/import",
            data={"name": "bad"},
            files={"file": ("config.yaml", content, "application/yaml")},
        )
        assert response.status_code == 422
    config = b"mate:\n  seed: 42\n  device: cpu\n  experiment: imported\ntask:\n  type: MyTask\n"
    response = client.post(
        "/api/v1/experiments/import",
        data={"name": "imported", "bindings": "{}"},
        files={"file": ("config.yaml", config)},
    )
    assert response.status_code == 201
    assert response.json()["data"]["native_config"]["mate"]["seed"] == 42


def test_failed_sql_publication_preserves_previous_template(client: TestClient, monkeypatch):
    from batteryland.domain.errors import DomainError
    from batteryland.infrastructure.persistence.configurations import SqlTemplateRepository

    template = client.post(
        "/api/v1/templates", json={"name": "atomic", "native_config": native()}
    ).json()["data"]

    def fail(*args, **kwargs):
        raise DomainError("storage_busy", "Simulated failure after document publication")

    monkeypatch.setattr(SqlTemplateRepository, "update", fail)
    endpoint = f"/api/v1/templates/{template['id']}"
    response = client.put(
        endpoint,
        json={"name": "atomic", "native_config": native(label="new"), "expected_revision": 1},
    )
    assert response.status_code == 503
    preserved = client.get(endpoint).json()["data"]
    assert preserved["revision"] == 1 and preserved["native_config"] == native()
