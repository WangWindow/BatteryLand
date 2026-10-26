from fastapi.testclient import TestClient

from tests.integration.test_splits_api import selection, setup_batteries


def test_real_set_counts_overlap_and_missing_categories(client: TestClient):
    source, ids = setup_batteries(client)
    split = client.post(
        "/api/v1/splits",
        json={
            "name": "analysis",
            "source_selections": selection(client, source, ids),
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
    chart = client.post(
        "/api/v1/charts", json={"chart_type": "set_count_bar", "sets": sets}
    ).json()["data"]
    assert [point["y"] for point in chart["charts"][0]["series"][0]["points"]] == [2, 4]


def test_difference_accepts_fixed_source_and_saved_training_split(client: TestClient):
    source, ids = setup_batteries(client)
    split = client.post(
        "/api/v1/splits",
        json={
            "name": "default-train",
            "source_selections": selection(client, source, ids),
            "method": "manual",
            "partitions": {"train": ids[:1], "val": ids[1:3], "test": ids[3:]},
        },
    ).json()["data"]

    response = client.post(
        "/api/v1/differences",
        json={
            "sets": [
                {"label": "fixed source", "source_id": source},
                {
                    "label": "default train",
                    "split": {"id": split["id"], "version": 1},
                    "partitions": ["train"],
                },
            ],
            "analysis_kind": "counts",
        },
    )
    assert response.status_code == 200
    body = response.json()["data"]
    assert [item["count"] for item in body["statistics"]["counts"]] == [4, 1]
    assert body["warnings"] == []
    assert body["sets"][0]["source_id"] == source
    assert body["sets"][1]["split"] == {"id": split["id"], "version": 1}


def test_difference_reference_must_select_exactly_one_candidate(client: TestClient):
    for reference in (
        {},
        {
            "source_id": "00000000-0000-0000-0000-000000000000",
            "split": {"id": "00000000-0000-0000-0000-000000000000", "version": 1},
        },
    ):
        response = client.post(
            "/api/v1/differences",
            json={
                "sets": [{"label": "invalid", **reference}],
                "analysis_kind": "counts",
            },
        )
        assert response.status_code == 422
