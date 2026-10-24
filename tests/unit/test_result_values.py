from batteryland.domain.results import normalize_metrics


def test_provider_units_use_component_identity_and_preserve_custom_null():
    values = normalize_metrics(
        {"epoch": 1, "test": {"mape": 0.1, "seen_acc15": 85, "ABC": None}},
        {
            "metric": [{"type": "mape"}, {"type": "accuracy", "name": "acc15"}],
            "task": {"type": "BatteryLifeRun"},
        },
    )
    assert [(item["value"], item["unit"], item["granularity"]) for item in values] == [
        (0.1, "ratio", "window"),
        (85, "percent", "window"),
        (None, "unknown", "window"),
    ]
