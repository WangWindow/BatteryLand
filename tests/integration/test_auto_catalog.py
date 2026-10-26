import json
import time
from dataclasses import replace

from fastapi.testclient import TestClient

from batteryland.api.app import create_app


def wait_for_catalog(client: TestClient) -> None:
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        status = client.get("/api/v1/catalog/status").json()["data"]
        if status["state"] == "ready":
            return
        if status["state"] == "failed":
            raise AssertionError(status["error"])
        time.sleep(0.01)
    raise AssertionError("background catalog scan did not finish")


def test_configured_fixed_files_are_indexed_without_manual_import(settings):
    root = settings.source_roots["demo"]
    (root / "group-a").mkdir()
    (root / "group-a" / "one.pkl").write_bytes(b"one")
    (root / "group-a" / "two.pkl").write_bytes(b"two")
    configured = replace(settings, auto_index_catalog=True)
    with TestClient(create_app(configured, start_monitor=False)) as client:
        wait_for_catalog(client)
        sources = client.get("/api/v1/data-sources").json()["data"]["items"]
        indexed = next(item for item in sources if item["root_alias"] == "demo")
        assert indexed["battery_count"] == 2
        batteries = client.get("/api/v1/batteries", params={"source_id": indexed["id"]})
        assert batteries.status_code == 200
        assert {item["file_name"] for item in batteries.json()["data"]["items"]} == {
            "one.pkl",
            "two.pkl",
        }


def test_same_filename_in_two_original_groups_keeps_two_battery_identities(settings):
    root = settings.source_roots["demo"]
    for group in ("group-a", "group-b"):
        (root / group).mkdir()
        (root / group / "repeat.pkl").write_bytes(group.encode())
    configured = replace(settings, auto_index_catalog=True)
    with TestClient(create_app(configured, start_monitor=False)) as client:
        wait_for_catalog(client)
        sources = client.get("/api/v1/data-sources").json()["data"]["items"]
        groups = [item for item in sources if item["root_alias"] == "demo"]
        assert len(groups) == 2
        assert {item["name"] for item in groups} == {"group-a", "group-b"}
        rows = client.get("/api/v1/batteries", params={"q": "repeat.pkl"}).json()["data"]["items"]
        assert len(rows) == 2
        assert len({item["id"] for item in rows}) == 2


def test_provider_split_is_indexed_as_read_only_training_split(settings, tmp_path):
    root = tmp_path / "BatteryLife_Processed"
    for group, filename in (("CALCE", "unique.pkl"), ("one", "same.pkl"), ("two", "same.pkl")):
        (root / group).mkdir(parents=True)
        (root / group / filename).write_bytes(
            b"same bytes" if filename == "same.pkl" else b"unique"
        )
    provider = tmp_path / "provider"
    folder = provider / "datasets/batteryLife/data_split"
    folder.mkdir(parents=True)
    document = {"dataset": "demo", "train": ["same.pkl"], "val": ["unique.pkl"], "test": []}
    (folder / "demo.json").write_text(json.dumps(document))
    configured = replace(
        settings, source_roots={"pool": root}, provider_root=provider, auto_index_catalog=True
    )
    with TestClient(create_app(configured)) as client:
        wait_for_catalog(client)
        sources = client.get("/api/v1/data-sources").json()["data"]
        assert sources["total"] == 3
        assert sum(item["battery_count"] for item in sources["items"]) == 3
        groups = client.get("/api/v1/splits").json()["data"]
        assert groups["total"] == 1
        builtin = groups["items"][0]
        assert builtin["origin"] == "builtin"
        assert builtin["read_only"] is True
        assert builtin["execution_ready"] is False
        assert builtin["counts"] == {"train": 1, "val": 1, "test": 0}
        assert builtin["resolution"]["ambiguous"] == 1
        details = client.get(f"/api/v1/splits/{builtin['id']}").json()["data"]
        assert details["resolution"]["issues"][0]["file_name"] == "same.pkl"
        assert len(details["resolution"]["issues"][0]["candidates"]) == 2
        batteries = client.get("/api/v1/batteries", params={"q": "same.pkl"}).json()["data"][
            "items"
        ]
        assert len(batteries) == 2
        assert client.put(f"/api/v1/splits/{builtin['id']}", json={}).status_code == 409
        assert client.delete(f"/api/v1/splits/{builtin['id']}").status_code == 409


def test_provider_split_index_is_stable_and_versions_manifest_changes(settings, tmp_path):
    root = tmp_path / "BatteryLife_Processed"
    (root / "CALCE").mkdir(parents=True)
    (root / "CALCE" / "cell.pkl").write_bytes(b"cell")
    provider = tmp_path / "provider"
    folder = provider / "datasets/batteryLife/data_split"
    folder.mkdir(parents=True)
    manifest = {"dataset": "CALCE", "train": ["cell.pkl"], "val": [], "test": []}
    path = folder / "CALCE.json"
    path.write_text(json.dumps(manifest))
    configured = replace(
        settings, source_roots={"pool": root}, provider_root=provider, auto_index_catalog=True
    )
    with TestClient(create_app(configured)) as client:
        wait_for_catalog(client)
        first = client.get("/api/v1/splits").json()["data"]["items"][0]
        time.sleep(0.01)
        manifest["val"] = ["cell.pkl"]
        manifest["train"] = []
        path.write_text(json.dumps(manifest))
        client.app.state.container.catalog_indexer.index()
        second = client.get("/api/v1/splits").json()["data"]["items"][0]
        assert second["id"] == first["id"]
        assert second["version"] == first["version"] + 1
        previous = client.get(
            f"/api/v1/splits/{first['id']}", params={"version": first["version"]}
        ).json()["data"]
        assert previous["counts"] == {"train": 1, "val": 0, "test": 0}
