import math

from batteryland.datasets.statistics import summarize_dataset


def test_statistics_separate_numeric_missing_categories_and_unsupported_values() -> None:
    result = summarize_dataset(
        {
            "train": ["a", "b"],
            "val": ["c"],
            "test": [],
        },
        {
            "a": {
                "capacity": 1.0,
                "chemistry": "NMC",
                "shape": [1, 2],
                "custom": 2,
                "non_finite": math.nan,
            },
            "b": {
                "capacity": 3.0,
                "chemistry": "NMC",
                "custom": True,
                "non_finite": 1.0,
            },
            "c": {
                "capacity": None,
                "chemistry": None,
                "custom": {"source": "user"},
            },
        },
    )

    all_scope = result["scopes"]["all"]
    assert all_scope["sample_count"] == 3
    assert all_scope["attributes"]["capacity"] == {
        "kind": "numeric",
        "valid_count": 2,
        "missing_count": 1,
        "unsupported_count": 0,
        "min": 1.0,
        "max": 3.0,
        "mean": 2.0,
    }
    assert all_scope["attributes"]["chemistry"] == {
        "kind": "categorical",
        "valid_count": 2,
        "missing_count": 1,
        "unsupported_count": 0,
        "categories": [{"value_type": "string", "value": "NMC", "count": 2}],
    }
    assert all_scope["attributes"]["shape"] == {
        "kind": "categorical",
        "valid_count": 0,
        "missing_count": 2,
        "unsupported_count": 1,
        "categories": [],
    }
    assert all_scope["attributes"]["custom"] == {
        "kind": "categorical",
        "valid_count": 2,
        "missing_count": 0,
        "unsupported_count": 1,
        "categories": [
            {"value_type": "boolean", "value": True, "count": 1},
            {"value_type": "integer", "value": 2, "count": 1},
        ],
    }
    assert all_scope["attributes"]["non_finite"] == {
        "kind": "numeric",
        "valid_count": 1,
        "missing_count": 1,
        "unsupported_count": 1,
        "min": 1.0,
        "max": 1.0,
        "mean": 1.0,
    }
    assert result["scopes"]["train"]["sample_count"] == 2
    assert result["scopes"]["val"]["attributes"]["capacity"]["missing_count"] == 1
    assert result["scopes"]["test"] == {"sample_count": 0, "attributes": {}}


def test_statistics_keep_typed_categories_and_reject_non_scalar_values() -> None:
    result = summarize_dataset(
        {"train": ["a", "b", "c"], "val": [], "test": []},
        {"a": {"label": 1}, "b": {"label": "1"}, "c": {"label": False}},
    )

    assert result["scopes"]["all"]["attributes"]["label"] == {
        "kind": "categorical",
        "valid_count": 3,
        "missing_count": 0,
        "unsupported_count": 0,
        "categories": [
            {"value_type": "boolean", "value": False, "count": 1},
            {"value_type": "integer", "value": 1, "count": 1},
            {"value_type": "string", "value": "1", "count": 1},
        ],
    }
