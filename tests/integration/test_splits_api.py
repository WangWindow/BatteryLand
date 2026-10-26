import json

from fastapi.testclient import TestClient


def setup_batteries(client: TestClient) -> tuple[str, list[str]]:
    root = client.app.state.settings.source_roots["demo"]
    for name in "abcd":
        (root / f"{name}.pkl").write_bytes(name.encode())
    resources = client.app.state.container.resources
    source = resources.create_source("demo", "demo")
    resources.import_batteries(source["id"], [{"file_name": f"{name}.pkl"} for name in "abcd"])
    batteries = client.get("/api/v1/batteries").json()["data"]["items"]
    return source["id"], [
        item["id"] for item in sorted(batteries, key=lambda item: item["file_name"])
    ]


def selection(
    client: TestClient, source_id: str, battery_ids: list[str]
) -> list[dict[str, object]]:
    sources = client.get("/api/v1/data-sources", params={"page_size": 200}).json()["data"]["items"]
    source = next(item for item in sources if item["id"] == source_id)
    return [
        {
            "source_id": source_id,
            "expected_revision": source["revision"],
            "battery_ids": battery_ids,
        }
    ]


def test_split_versions_members_and_provider_export(client: TestClient) -> None:
    source, ids = setup_batteries(client)
    body = {
        "name": "custom",
        "source_selections": selection(client, source, ids),
        "method": "manual",
        "partitions": {"train": ids[:2], "val": ids[2:3], "test": ids[3:]},
    }
    preview = client.post("/api/v1/splits/preview", json=body)
    assert preview.status_code == 200
    assert preview.json()["data"]["counts"] == {"all": 4, "train": 2, "val": 1, "test": 1}
    response = client.post("/api/v1/splits", json=body)
    assert response.status_code == 201
    split = response.json()["data"]
    endpoint = f"/api/v1/splits/{split['id']}"
    exported = client.get(endpoint + "/export").json()
    assert exported == {
        "dataset": "custom",
        "train": ["a.pkl", "b.pkl"],
        "val": ["c.pkl"],
        "test": ["d.pkl"],
    }
    assert (
        client.get(endpoint + "/members", params={"partition": "train"}).json()["data"]["total"]
        == 2
    )
    changed = dict(
        body, expected_revision=1, partitions={"train": ids[:1], "val": ids[1:3], "test": ids[3:]}
    )
    assert client.put(endpoint, json=changed).json()["data"]["head_version"] == 2
    assert client.get(endpoint + "/export", params={"version": 1}).json() == exported
    assert client.put(endpoint, json=changed).status_code == 409


def test_split_import_and_invalid_overlap(client: TestClient) -> None:
    source, ids = setup_batteries(client)
    failure = client.post(
        "/api/v1/splits",
        json={
            "name": "bad",
            "source_selections": selection(client, source, ids[:1]),
            "method": "manual",
            "partitions": {"train": ids[:1], "val": ids[:1], "test": []},
        },
    )
    assert failure.status_code == 422
    imported = client.post(
        "/api/v1/splits/import",
        files={
            "file": (
                "split.json",
                b'{"dataset":"external","train":["a.pkl"],"val":["b.pkl"],"test":["c.pkl"]}',
                "application/json",
            )
        },
    )
    assert imported.status_code == 201
    assert imported.json()["data"]["counts"] == {"train": 1, "val": 1, "test": 1}


def test_split_import_preview_global_match_and_manual_disambiguation(client: TestClient) -> None:
    source, _ = setup_batteries(client)
    resources = client.app.state.container.resources
    (client.app.state.settings.source_roots["demo"] / "shared.pkl").write_bytes(b"demo")
    resources.import_batteries(source, [{"file_name": "shared.pkl"}])
    (client.app.state.settings.source_roots["other"] / "shared.pkl").write_bytes(b"other")
    other = resources.create_source("other pool", "other")
    resources.import_batteries(other["id"], [{"file_name": "shared.pkl"}])
    candidates = client.get("/api/v1/batteries", params={"q": "shared.pkl"}).json()["data"]["items"]
    assert len(candidates) == 2

    document = {
        "dataset": "external",
        "train": ["a.pkl"],
        "val": ["shared.pkl"],
        "test": ["b.pkl"],
    }
    upload = {
        "file": (
            "split.json",
            json.dumps(document).encode(),
            "application/json",
        )
    }
    preview = client.post("/api/v1/splits/import/preview", files=upload)
    assert preview.status_code == 200
    preview_data = preview.json()["data"]
    assert preview_data["execution_ready"] is False
    assert preview_data["resolution"]["matched"] == 2
    assert preview_data["resolution"]["ambiguous"] == 1
    issue = preview_data["resolution"]["issues"][0]
    assert issue["file_name"] == "shared.pkl"
    assert len(issue["candidates"]) == 2

    unresolved = client.post("/api/v1/splits/import", files=upload)
    assert unresolved.status_code == 422
    assert client.get("/api/v1/splits").json()["data"]["total"] == 0

    resolution = {"shared.pkl": candidates[0]["id"]}
    imported = client.post(
        "/api/v1/splits/import",
        data={"member_bindings": json.dumps(resolution)},
        files=upload,
    )
    assert imported.status_code == 201
    split = imported.json()["data"]
    assert split["origin"] == "imported"
    assert split["execution_ready"] is True
    assert split["counts"] == {"train": 1, "val": 1, "test": 1}


def test_split_import_preview_reports_missing_batteries_without_persisting(
    client: TestClient,
) -> None:
    setup_batteries(client)
    document = {
        "dataset": "external",
        "train": ["unknown.pkl"],
        "val": ["a.pkl"],
        "test": ["b.pkl"],
    }
    upload = {
        "file": (
            "split.json",
            json.dumps(document).encode(),
            "application/json",
        )
    }
    preview = client.post("/api/v1/splits/import/preview", files=upload)
    assert preview.status_code == 200
    assert preview.json()["data"]["resolution"]["missing"] == 1
    imported = client.post("/api/v1/splits/import", files=upload)
    assert imported.status_code == 422
    assert client.get("/api/v1/splits").json()["data"]["total"] == 0
