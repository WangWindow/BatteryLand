from typing import Any

from batteryland.domain.errors import DomainError


def compare_results(
    results: list[dict[str, Any]],
    selected_metrics: list[str] | None = None,
    battery_ids: list[str] | None = None,
) -> dict[str, Any]:
    identities = [item["experiment_id"] for item in results]
    if not identities or len(set(identities)) != len(identities):
        raise DomainError("invalid_input", "Select a nonempty unique experiment list")
    metric_keys = sorted(
        {
            (row["stage"], row["name"])
            for item in results
            for row in item["metrics"]
            if selected_metrics is None or row["name"] in selected_metrics
        }
    )
    batteries = sorted(
        {
            row["battery_id"]
            for item in results
            for row in item["predictions"]
            if battery_ids is None or row["battery_id"] in battery_ids
        }
    )
    metric_rows: list[dict[str, Any]] = []
    prediction_rows: list[dict[str, Any]] = []
    warnings: list[str] = []
    sources: list[dict[str, Any]] = []
    for item in results:
        identity = item["experiment_id"]
        lookup = {(row["stage"], row["name"]): row for row in item["metrics"]}
        predictions = {row["battery_id"]: row for row in item["predictions"]}
        for stage, name in metric_keys:
            row = lookup.get(
                (stage, name),
                {
                    "stage": stage,
                    "name": name,
                    "epoch": None,
                    "value": None,
                    "unit": "unknown",
                    "granularity": "unknown",
                },
            )
            metric_rows.append(row | {"experiment_id": identity})
        for battery in batteries:
            row = predictions.get(battery, {"prediction": None, "target": None})
            prediction_rows.append(
                {
                    "experiment_id": identity,
                    "battery_id": battery,
                    "prediction": row["prediction"],
                    "target": row["target"],
                    "granularity": row.get("granularity", "unknown"),
                }
            )
        warnings.extend(f"{identity}: {warning}" for warning in item["warnings"])
        sources.extend(item["sources"])
        if not item["available"]:
            warnings.append(f"{identity}: {item['reason'] or 'Result is unavailable'}")
        if any(key not in lookup for key in metric_keys) or any(
            battery not in predictions for battery in batteries
        ):
            warnings.append(f"{identity}: missing measurements are represented by null")
    return {
        "schema_version": 1,
        "metric_rows": metric_rows,
        "prediction_rows": prediction_rows,
        "warnings": warnings,
        "sources": sources,
    }
