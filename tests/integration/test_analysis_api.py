from fastapi.testclient import TestClient

from tests.integration.test_splits_api import setup_batteries


def test_real_set_counts_overlap_and_missing_categories(client: TestClient):
    source, ids = setup_batteries(client)
    split = client.post(
        "/api/v1/splits",
        json={
            "name": "analysis",
            "source_id": source,
            "expected_source_revision": client.get("/api/v1/data-sources").json()["data"]["items"][
                0
            ]["revision"],
            "battery_ids": ids,
            "method": "manual",
            "partitions": {"train": ids[:2], "val": ids[2:3], "test": ids[3:]},
        },
    ).json()["data"]
    sets = [
        {"label": "training", "split": {"id": split["id"], "version": 1}, "partitions": ["train"]},
        {"label": "all", "split": {"id": split["id"], "version": 1}},
    ]
    counts = client.post("/api/v1/differences", json={"sets": sets, "analysis_kind": "counts"})
    assert counts.status_code == 200
    assert [item["count"] for item in counts.json()["data"]["statistics"]["counts"]] == [2, 4]
    overlap = client.post(
        "/api/v1/differences", json={"sets": sets, "analysis_kind": "overlap"}
    ).json()["data"]
    assert overlap["statistics"]["pairs"][0]["intersection"] == 2
    categories = client.post(
        "/api/v1/differences",
        json={"sets": sets, "analysis_kind": "category_distribution", "category": "chemistry"},
    ).json()["data"]
    assert [item["missing"] for item in categories["statistics"]["distributions"]] == [2, 4]
    chart = client.post("/api/v1/charts", json={"chart_type": "set_count_bar", "sets": sets}).json()[
        "data"
    ]
    assert [point["y"] for point in chart["charts"][0]["series"][0]["points"]] == [2, 4]
