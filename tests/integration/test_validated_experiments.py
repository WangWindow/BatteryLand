from dataclasses import replace

from fastapi.testclient import TestClient

from batteryland.api.app import create_app
from tests.support import register_split

COMMIT = "6b4c76d6e639ddaf9db9c15bf04771179a68d988"
CONFIG = """mate:\n  device: auto\ndatafactory:\n  type: BatteryLandBatteryLifeDatasetFactory\n  params:\n    dataset: demo\n"""


def test_only_provider_validated_original_documents_are_saved(settings):
    configured = replace(settings, validation_secret="shared-secret")
    registered = register_split(
        configured,
        "demo",
        ("a.pkl", "b.pkl", "c.pkl"),
        {"train": ("a.pkl",), "val": ("b.pkl",), "test": ("c.pkl",)},
        root_alias="demo",
    )
    split = registered["split"]
    reference = {"split_id": split["id"], "split_version": split["version"]}

    with TestClient(create_app(configured, start_monitor=False)) as client:
        service = client.app.state.container.training_runs
        service.gateway.identity = lambda: COMMIT
        service.gateway.validate_structure = lambda value: {
            "valid": True,
            "errors": [],
            "warnings": [],
            "components": [],
        }
        validation = client.post(
            "/api/v1/training/validation",
            json={"config_text": CONFIG, **reference},
        )
        assert validation.status_code == 200, validation.text
        validated = validation.json()["data"]
        body = {
            "name": "first",
            "config_text": CONFIG,
            "split_text": validated["split_text"],
            **reference,
            "receipt": validated["receipt"],
        }

        tampered = client.post(
            "/api/v1/validated-experiments", json=body | {"config_text": CONFIG + "\n"}
        )
        assert tampered.status_code == 422
        created = client.post("/api/v1/validated-experiments", json=body)
        assert created.status_code == 201, created.text
        identity = created.json()["data"]["id"]
        listed = client.get("/api/v1/validated-experiments")
        assert listed.status_code == 200, listed.text
        assert listed.json()["data"]["items"][0]["kind"] == "train"
        stored = client.get(f"/api/v1/validated-experiments/{identity}")
        assert stored.status_code == 200
        assert stored.json()["data"]["config_text"] == CONFIG
        assert stored.json()["data"]["split_text"] == validated["split_text"]
        assert stored.json()["data"]["split_id"] == split["id"]
        assert stored.json()["data"]["split_version"] == 1
        assert stored.json()["data"]["split_counts"] == {"train": 1, "val": 1, "test": 1}
        members = client.get(
            f"/api/v1/validated-experiments/{identity}/members",
            params={"partition": "test", "page_size": 1},
        )
        assert members.status_code == 200, members.text
        assert members.json()["data"]["items"] == [
            {"partition": "test", "ordinal": 0, "file_name": "c.pkl"}
        ]
        assert stored.json()["data"]["receipt"]["config_sha256"] == validated["receipt"][
            "config_sha256"
        ]

        container = client.app.state.container
        root = configured.source_roots["demo"]
        (root / "d.pkl").write_bytes(b"d.pkl")
        container.resources.import_batteries(
            registered["source"]["id"], [{"file_name": "d.pkl"}]
        )
        d_battery = container.resources.list_batteries(
            {"source_id": registered["source"]["id"], "q": "d.pkl"}, 1, 10
        )["items"][0]
        source_revision = container.resources.list_sources(1, 10)["items"][0]["revision"]
        updated_split = client.put(
            f"/api/v1/splits/{split['id']}",
            json={
                "expected_revision": 1,
                "name": "demo",
                "source_selections": [
                    {
                        "source_id": registered["source"]["id"],
                        "expected_revision": source_revision,
                        "battery_ids": [
                            registered["batteries"]["a.pkl"],
                            registered["batteries"]["b.pkl"],
                            d_battery["id"],
                        ],
                    }
                ],
                "method": "manual",
                "partitions": {
                    "train": [registered["batteries"]["a.pkl"]],
                    "val": [registered["batteries"]["b.pkl"]],
                    "test": [d_battery["id"]],
                },
            },
        )
        assert updated_split.status_code == 200, updated_split.text
        revised_validation = client.post(
            "/api/v1/training/validation",
            json={
                "config_text": CONFIG.replace("auto", "cuda:1"),
                "split_id": split["id"],
                "split_version": 2,
            },
        )
        assert revised_validation.status_code == 200, revised_validation.text
        changed = revised_validation.json()["data"]
        updated = client.put(
            f"/api/v1/validated-experiments/{identity}",
            json={
                "expected_revision": 1,
                "name": "edited",
                "config_text": CONFIG.replace("auto", "cuda:1"),
                "split_text": changed["split_text"],
                "split_id": split["id"],
                "split_version": 2,
                "receipt": changed["receipt"],
            },
        )
        assert updated.status_code == 200, updated.text
        assert updated.json()["data"]["version"] == 2
        assert updated.json()["data"]["split_version"] == 2
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
                    "split_text": validated["split_text"],
                    **reference,
                    "receipt": validated["receipt"],
                },
            ).status_code
            == 409
        )
