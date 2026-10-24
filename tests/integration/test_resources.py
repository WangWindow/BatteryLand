from fastapi.testclient import TestClient


def test_import_is_idempotent_and_lists_are_filtered(client: TestClient) -> None:
    response = client.post("/api/v1/data-sources", json={"name": "Demo", "root_alias": "demo"})
    assert response.status_code == 201
    source = response.json()["data"]
    manifest = {
        "batteries": [
            {"file_name": "a.pkl", "metadata": {"chemistry": "LFP", "temperature_c": 25}},
            {"file_name": "b.pkl", "metadata": {"chemistry": "NMC"}},
        ]
    }
    endpoint = f"/api/v1/data-sources/{source['id']}/import"
    first = client.post(endpoint, json=manifest)
    assert first.json()["data"] == {"imported": 2, "existing": 0, "errors": []}
    second = client.post(endpoint, json=manifest)
    assert second.json()["data"] == {"imported": 0, "existing": 2, "errors": []}
    page = client.get("/api/v1/batteries", params={"chemistry": "LFP", "page_size": 1})
    assert page.status_code == 200
    assert page.json()["data"]["total"] == 1
    battery = page.json()["data"]["items"][0]
    assert battery["metadata"] == {"chemistry": "LFP", "temperature_c": 25}
    assert battery["availability"] == "missing"


def test_sources_preserve_identity_and_import_errors_do_not_partially_apply(
    client: TestClient,
) -> None:
    sources = [
        client.post("/api/v1/data-sources", json={"name": alias, "root_alias": alias}).json()[
            "data"
        ]
        for alias in ["demo", "other"]
    ]
    for source in sources:
        client.post(
            f"/api/v1/data-sources/{source['id']}/import",
            json={"batteries": [{"file_name": "same.pkl"}]},
        ).raise_for_status()
    batteries = client.get("/api/v1/batteries").json()["data"]["items"]
    assert len(batteries) == 2
    assert len({item["id"] for item in batteries}) == 2
    failure = client.post(
        f"/api/v1/data-sources/{sources[0]['id']}/import",
        json={"batteries": [{"file_name": "valid.pkl"}, {"file_name": "../escape.pkl"}]},
    )
    assert failure.status_code == 422
    assert client.get("/api/v1/batteries").json()["data"]["total"] == 2


def test_unknown_source_alias_and_conflicting_import_are_rejected(client: TestClient) -> None:
    assert (
        client.post(
            "/api/v1/data-sources", json={"name": "escape", "root_alias": "/etc"}
        ).status_code
        == 422
    )
    source = client.post(
        "/api/v1/data-sources", json={"name": "demo", "root_alias": "demo"}
    ).json()["data"]
    endpoint = f"/api/v1/data-sources/{source['id']}/import"
    client.post(endpoint, json={"batteries": [{"file_name": "a.pkl"}]}).raise_for_status()
    failure = client.post(
        endpoint, json={"batteries": [{"file_name": "a.pkl", "metadata": {"chemistry": "LFP"}}]}
    )
    assert failure.status_code == 409
    assert client.get("/api/v1/batteries").json()["data"]["total"] == 1
