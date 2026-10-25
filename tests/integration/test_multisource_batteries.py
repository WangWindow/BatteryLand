from fastapi.testclient import TestClient


def test_battery_catalog_filters_multiple_sources_and_exposes_facets(client: TestClient) -> None:
    resources = client.app.state.container.resources
    first = resources.create_source("First", "demo")
    second = resources.create_source("Second", "other")
    resources.import_batteries(
        first["id"],
        [
            {
                "file_name": "first.pkl",
                "relative_key": "cells/first.pkl",
                "metadata": {"chemistry": "NMC", "temperature_c": 25},
            }
        ],
    )
    resources.import_batteries(
        second["id"],
        [
            {
                "file_name": "second.pkl",
                "relative_key": "cells/second.pkl",
                "metadata": {"chemistry": "LFP", "temperature_c": 35},
            }
        ],
    )

    response = client.get(
        "/api/v1/batteries",
        params={
            "source_ids": [first["id"], second["id"]],
            "temperature_c_min": 20,
            "temperature_c_max": 30,
            "page_size": 200,
        },
    )

    assert response.status_code == 200
    result = response.json()["data"]
    assert result["total"] == 1
    assert result["items"][0]["source_id"] == first["id"]

    facets = client.get(
        "/api/v1/batteries/facets", params={"source_ids": [first["id"], second["id"]]}
    )
    assert facets.status_code == 200
    assert facets.json()["data"]["values"]["chemistry"] == ["LFP", "NMC"]
    assert facets.json()["data"]["ranges"]["temperature_c"] == {"min": 25, "max": 35}
