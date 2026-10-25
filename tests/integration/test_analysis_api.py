import csv
import io
import json

from fastapi.testclient import TestClient
from tests.integration.test_scheduler import ControlledTraining, advance, draft
from tests.integration.test_splits_api import setup_batteries

from batteryland.config import Settings
from batteryland.interfaces.api.app import create_app


def test_comparison_union_missing_values_and_declarative_charts(settings: Settings):
    app = create_app(settings, training=ControlledTraining(settings), start_monitor=False)
    with TestClient(app) as client:
        entries = [draft(client, name) for name in ("first", "second")]
        ids = [item["id"] for item in entries]
        client.post("/api/v1/queue/submissions", json={"experiment_ids": ids}).raise_for_status()
        assert advance(app.state.container, client, ids) == ["succeeded", "succeeded"]
        values = [
            {
                "test": {"mape": 0.1, "ABC": None},
                "units": {"mape": "ratio"},
                "test_predictions": [{"file_name": "a.pkl", "prediction": 10}],
            },
            {
                "test": {"mae": 3, "ABC": 8},
                "test_predictions": [{"file_name": "b.pkl", "prediction": 20, "target": 18}],
            },
        ]
        for identity, value in zip(ids, values, strict=True):
            (settings.data_dir / "runs" / identity / "best_result.json").write_text(
                json.dumps(value)
            )
            app.state.container.results.collect(identity)
        response = client.post("/api/v1/comparisons", json={"experiment_ids": ids})
        assert response.status_code == 200
        data = response.json()["data"]
        assert len(data["metric_rows"]) == 6 and len(data["prediction_rows"]) == 4
        assert len(data["sources"]) == 2
        assert (
            next(
                row
                for row in data["metric_rows"]
                if row["experiment_id"] == ids[1] and row["name"] == "mape"
            )["value"]
            is None
        )
        csv_response = client.post(
            "/api/v1/comparisons/export", json={"experiment_ids": ids, "format": "csv"}
        )
        assert (
            csv_response.status_code == 200
            and "attachment" in csv_response.headers["content-disposition"]
        )
        assert len(list(csv.DictReader(io.StringIO(csv_response.text)))) == 10
        chart = client.post(
            "/api/v1/charts",
            json={
                "chart_type": "metric_bar",
                "experiment_ids": ids,
                "metric": "ABC",
                "stage": "test",
            },
        )
        assert chart.status_code == 200 and len(chart.json()["data"]["charts"]) == 2
        scatter = {"chart_type": "prediction_scatter", "experiment_ids": ids[:1]}
        assert (
            client.post("/api/v1/charts", json=scatter).json()["data"]["error"] == "no_ground_truth"
        )
        scatter["experiment_ids"] = ids
        assert (
            client.post("/api/v1/charts", json=scatter).json()["data"]["charts"][0]["kind"]
            == "scatter"
        )


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
    chart = client.post(
        "/api/v1/charts", json={"chart_type": "set_count_bar", "sets": sets}
    ).json()["data"]
    assert [point["y"] for point in chart["charts"][0]["series"][0]["points"]] == [2, 4]
