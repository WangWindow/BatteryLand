from dataclasses import replace

from fastapi.testclient import TestClient

from batteryland.domain.validation_receipt import issue_receipt
from batteryland.interfaces.api.app import create_app

CONFIG = "mate:\n  device: auto\n"
SPLIT = '{"dataset":"demo","train":["a.pkl"],"val":["b.pkl"],"test":["c.pkl"]}'


def test_only_provider_validated_original_documents_are_saved(settings):
    configured = replace(settings, validation_secret="shared-secret")
    receipt = issue_receipt(
        CONFIG, SPLIT, "6b4c76d6e639ddaf9db9c15bf04771179a68d988", [], "shared-secret"
    )
    with TestClient(create_app(configured, start_monitor=False)) as client:
        body = {"name": "first", "config_text": CONFIG, "split_text": SPLIT, "receipt": receipt}
        tampered = client.post(
            "/api/v1/validated-experiments", json=body | {"config_text": CONFIG + "\n"}
        )
        assert tampered.status_code == 422
        created = client.post("/api/v1/validated-experiments", json=body)
        assert created.status_code == 201, created.text
        identity = created.json()["data"]["id"]
        stored = client.get(f"/api/v1/validated-experiments/{identity}")
        assert stored.status_code == 200
        assert stored.json()["data"]["config_text"] == CONFIG
        assert stored.json()["data"]["split_text"] == SPLIT
        assert stored.json()["data"]["split_counts"] == {"train": 1, "val": 1, "test": 1}
        members = client.get(
            f"/api/v1/validated-experiments/{identity}/members",
            params={"partition": "test", "page_size": 1},
        )
        assert members.status_code == 200, members.text
        assert members.json()["data"]["items"] == [
            {"partition": "test", "ordinal": 0, "file_name": "c.pkl"}
        ]
        assert stored.json()["data"]["receipt"]["config_sha256"] == receipt["config_sha256"]
        changed_config = CONFIG.replace("auto", "cuda:1")
        changed_split = SPLIT.replace("c.pkl", "d.pkl")
        changed_receipt = issue_receipt(
            changed_config,
            changed_split,
            "6b4c76d6e639ddaf9db9c15bf04771179a68d988",
            [],
            "shared-secret",
        )
        updated = client.put(
            f"/api/v1/validated-experiments/{identity}",
            json={
                "expected_revision": 1,
                "name": "edited",
                "config_text": changed_config,
                "split_text": changed_split,
                "receipt": changed_receipt,
            },
        )
        assert updated.status_code == 200, updated.text
        assert updated.json()["data"]["version"] == 2
        original = client.get(f"/api/v1/validated-experiments/{identity}", params={"version": 1})
        assert original.json()["data"]["config_text"] == CONFIG
        original_member = client.get(
            f"/api/v1/validated-experiments/{identity}/members",
            params={"version": 1, "partition": "test"},
        ).json()["data"]["items"][0]
        current_member = client.get(
            f"/api/v1/validated-experiments/{identity}/members", params={"partition": "test"}
        ).json()["data"]["items"][0]
        assert original_member["file_name"] == "c.pkl"
        assert current_member["file_name"] == "d.pkl"
        assert client.post(f"/api/v1/validated-experiments/{identity}/submit").status_code == 202
        assert (
            client.put(
                f"/api/v1/validated-experiments/{identity}",
                json={
                    "expected_revision": 2,
                    "name": "too late",
                    "config_text": CONFIG,
                    "split_text": SPLIT,
                    "receipt": receipt,
                },
            ).status_code
            == 409
        )
