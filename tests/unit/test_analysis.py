import pytest

from batteryland.domain.analysis import compare_results
from batteryland.domain.errors import DomainError
from batteryland.infrastructure.analysis import BasicChartBuilder, BasicDifferenceAnalyzer


def test_known_unit_and_granularity_facets_preserve_nulls():
    rows = [
        {
            "experiment_id": identity,
            "stage": "test",
            "name": "x",
            "epoch": 1,
            "value": value,
            "unit": unit,
            "granularity": granularity,
        }
        for identity, value, unit, granularity in [
            ("a", 0.1, "ratio", "window"),
            ("b", None, "percent", "window"),
            ("c", 1, "ratio", "battery"),
        ]
    ]
    builder = BasicChartBuilder()
    request = {"chart_type": "metric_bar", "stage": "test", "metric": "x"}
    bundle = builder.build(request, {"metric_rows": rows})
    assert len(bundle["charts"]) == 3
    assert [chart["series"][0]["points"][0]["y"] for chart in bundle["charts"]] == [0.1, None, 1]
    request["chart_type"] = "epoch_line"
    assert all(
        chart["kind"] == "line" for chart in builder.build(request, {"metric_rows": rows})["charts"]
    )


def test_identity_union_never_merges_same_file_name_from_different_sources():
    results = [
        {
            "experiment_id": identity,
            "available": True,
            "metrics": [],
            "sources": [],
            "warnings": [],
            "predictions": [
                {"battery_id": battery, "file_name": "same.pkl", "prediction": 1, "target": None}
            ],
        }
        for identity, battery in [("a", "source-a-id"), ("b", "source-b-id")]
    ]
    compared = compare_results(results)
    assert len(compared["prediction_rows"]) == 4
    assert sum(row["prediction"] is None for row in compared["prediction_rows"]) == 2
    with pytest.raises(DomainError, match="ground truth"):
        BasicChartBuilder().build(
            {"chart_type": "prediction_scatter", "experiment_ids": ["a", "b"]}, compared
        )


def test_difference_empty_sets_and_same_named_distinct_batteries():
    sets = [
        {
            "id": name,
            "label": name,
            "batteries": [{"id": name, "file_name": "same.pkl", "source_id": name, "metadata": {}}],
        }
        for name in ("a", "b")
    ]
    sets.append({"id": "empty", "label": "empty", "batteries": []})
    result = BasicDifferenceAnalyzer().compare(sets, "overlap", None)
    assert all(pair["intersection"] == 0 for pair in result["statistics"]["pairs"])
    assert result["statistics"]["counts"][-1]["count"] == 0
    with pytest.raises(DomainError, match="not implemented"):
        BasicDifferenceAnalyzer().compare(sets, "domain_distance", None)
