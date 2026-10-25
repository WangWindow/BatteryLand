from fastapi.testclient import TestClient


def setup_batteries(client: TestClient) -> tuple[str, list[str]]:
    resources = client.app.state.container.resources
    source = resources.create_source("demo", "demo")
    resources.import_batteries(
        source["id"], [{"file_name": f"{name}.pkl"} for name in "abcd"]
    )
    batteries = client.get("/api/v1/batteries").json()["data"]["items"]
    return source["id"], [
        item["id"] for item in sorted(batteries, key=lambda item: item["file_name"])
    ]


def selection(client: TestClient, source_id: str, battery_ids: list[str]) -> list[dict[str, object]]:
    sources = client.get("/api/v1/data-sources", params={"page_size": 200}).json()["data"][
        "items"
    ]
    source = next(item for item in sources if item["id"] == source_id)
    return [{"source_id": source_id, "expected_revision": source["revision"], "battery_ids": battery_ids}]


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
        data={"source_ids": source},
        files={
            "file": (
                "split.json",
                b'{"dataset":"external","train":["a.pkl"],"val":[],"test":["b.pkl"]}',
                "application/json",
            )
        },
    )
    assert imported.status_code == 201
    assert imported.json()["data"]["counts"] == {"train": 1, "val": 0, "test": 1}
