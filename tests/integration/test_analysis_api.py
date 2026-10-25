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


def test_difference_accepts_fixed_source_and_named_group(client: TestClient):
    source, ids = setup_batteries(client)
    with client.app.state.container.database.unit_of_work() as unit:
        unit.named_groups.put(
            "default-train",
            "a" * 64,
            {"dataset": "default-train", "train": ["a.pkl", "missing.pkl"]},
            {"train": 2, "val": 0, "test": 0},
            [
                {
                    "partition": "train",
                    "ordinal": 0,
                    "file_name": "a.pkl",
                    "battery_id": ids[0],
                    "match_status": "matched",
                    "candidate_count": 1,
                },
                {
                    "partition": "train",
                    "ordinal": 1,
                    "file_name": "missing.pkl",
                    "battery_id": None,
                    "match_status": "missing",
                    "candidate_count": 0,
                },
            ],
        )

    response = client.post(
        "/api/v1/differences",
        json={
            "sets": [
                {"label": "fixed source", "source_id": source},
                {"label": "default train", "named_group": "default-train", "partitions": ["train"]},
            ],
            "analysis_kind": "counts",
        },
    )
    assert response.status_code == 200
    body = response.json()["data"]
    assert [item["count"] for item in body["statistics"]["counts"]] == [4, 1]
    assert body["warnings"] == ["default train: 1 named-group members could not be resolved"]
    assert body["sets"][0]["source_id"] == source
    assert body["sets"][1]["named_group"] == "default-train"


def test_difference_reference_must_select_exactly_one_candidate(client: TestClient):
    for reference in ({}, {"source_id": "00000000-0000-0000-0000-000000000000", "named_group": "g"}):
        response = client.post(
            "/api/v1/differences",
            json={
                "sets": [{"label": "invalid", **reference}],
                "analysis_kind": "counts",
            },
        )
        assert response.status_code == 422
