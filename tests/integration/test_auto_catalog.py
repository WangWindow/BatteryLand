import json
from dataclasses import replace

from fastapi.testclient import TestClient

from batteryland.interfaces.api.app import create_app


def test_configured_fixed_files_are_indexed_without_manual_import(settings):
    root = settings.source_roots["demo"]
    (root / "group-a").mkdir()
    (root / "group-a" / "one.pkl").write_bytes(b"one")
    (root / "group-a" / "two.pkl").write_bytes(b"two")
    configured = replace(settings, auto_index_catalog=True)
    with TestClient(create_app(configured, start_monitor=False)) as client:
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
        sources = client.get("/api/v1/data-sources").json()["data"]["items"]
        groups = [item for item in sources if item["root_alias"] == "demo"]
        assert len(groups) == 2
        assert {item["name"] for item in groups} == {"group-a", "group-b"}
        rows = client.get("/api/v1/batteries", params={"q": "repeat.pkl"}).json()["data"]["items"]
        assert len(rows) == 2
        assert len({item["id"] for item in rows}) == 2


def test_named_split_shortcut_reports_ambiguous_members_without_dropping_files(settings, tmp_path):
    root = tmp_path / "BatteryLife_Processed"
    for group, filename in (("CALCE", "unique.pkl"), ("one", "same.pkl"), ("two", "same.pkl")):
        (root / group).mkdir(parents=True)
        (root / group / filename).write_bytes(group.encode())
    provider = tmp_path / "provider"
    folder = provider / "datasets/batteryLife/data_split"
    folder.mkdir(parents=True)
    document = {"dataset": "demo", "train": ["same.pkl"], "val": ["unique.pkl"], "test": []}
    (folder / "demo.json").write_text(json.dumps(document))
    configured = replace(
        settings, source_roots={"pool": root}, provider_root=provider, auto_index_catalog=True
    )
    with TestClient(create_app(configured)) as client:
        sources = client.get("/api/v1/data-sources").json()["data"]
        assert sources["total"] == 3
        assert sum(item["battery_count"] for item in sources["items"]) == 3
        groups = client.get("/api/v1/catalog/named-groups").json()["data"]
        assert groups["total"] == 1
        assert groups["items"][0]["counts"] == {
            "train": 1,
            "val": 1,
            "test": 0,
            "matched": 1,
            "missing": 0,
            "ambiguous": 1,
        }
        ambiguous = client.get(
            "/api/v1/catalog/named-groups/demo/members", params={"partition": "train"}
        ).json()["data"]["items"][0]
        assert ambiguous["match_status"] == "ambiguous"
        assert ambiguous["candidate_count"] == 2
        assert ambiguous["battery_id"] is None
        assert (
            client.get("/api/v1/catalog/named-groups/demo").json()["data"]["document"] == document
        )
