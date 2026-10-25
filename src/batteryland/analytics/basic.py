from collections import Counter
from itertools import combinations

from batteryland.common.errors import DomainError
from batteryland.db.contracts import Record


class BasicDifferenceAnalyzer:
    def compare(self, sets: list[Record], kind: str, category: str | None) -> Record:
        if kind not in {"counts", "overlap", "category_distribution"}:
            raise DomainError("unsupported_capability", "Difference analysis is not implemented")
        if kind == "category_distribution" and category not in {
            "source",
            "chemistry",
            "material",
            "temperature_c",
        }:
            raise DomainError("invalid_input", "Select a supported category")
        stats: Record = {
            "counts": [
                {"set_id": item["id"], "label": item["label"], "count": len(item["batteries"])}
                for item in sets
            ]
        }
        if kind == "overlap":
            pairs = []
            for left, right in combinations(sets, 2):
                a, b = ({row["id"] for row in item["batteries"]} for item in (left, right))
                pairs.append(
                    {
                        "left": left["id"],
                        "right": right["id"],
                        "label": f"{left['label']} ∩ {right['label']}",
                        "intersection": len(a & b),
                        "union": len(a | b),
                        "left_only": len(a - b),
                        "right_only": len(b - a),
                        "intersection_ids": sorted(a & b),
                        "left_only_ids": sorted(a - b),
                        "right_only_ids": sorted(b - a),
                    }
                )
            stats["pairs"] = pairs
        warnings = []
        if kind == "category_distribution":
            distributions = []
            for item in sets:
                counts: Counter[str | None] = Counter()
                for battery in item["batteries"]:
                    value = (
                        battery["source_id"]
                        if category == "source"
                        else battery["metadata"].get(category)
                    )
                    # Only registered scalar categories are comparable.
                    key = (
                        str(value)
                        if isinstance(value, (str, int, float)) and not isinstance(value, bool)
                        else None
                    )
                    counts[key] += 1
                missing = counts.get(None, 0)
                distributions.append(
                    {
                        "set_id": item["id"],
                        "label": item["label"],
                        "missing": missing,
                        "categories": [
                            {
                                "value": key,
                                "label": key if key is not None else "unknown",
                                "count": counts[key],
                            }
                            for key in sorted(
                                counts, key=lambda value: (value is None, value or "")
                            )
                        ],
                    }
                )
                if missing:
                    warnings.append(f"{item['label']}: {missing} batteries have unknown {category}")
            stats["distributions"] = distributions
        return {
            "schema_version": 1,
            "provider_id": "basic-difference/v1",
            "analysis_kind": kind,
            "sets": [
                {key: value for key, value in item.items() if key != "batteries"} for item in sets
            ],
            "statistics": stats,
            "warnings": warnings,
        }


def axis(label: str, unit: str | None, numeric: bool) -> Record:
    return {"label": label, "unit": unit, "value_type": "number" if numeric else "category"}


def chart(
    identity: str, kind: str, title: str, x: Record, y: Record, series: list[Record]
) -> Record:
    return {
        "id": identity,
        "kind": kind,
        "title": title,
        "x_axis": x,
        "y_axis": y,
        "series": series,
        "warnings": [],
    }


class BasicChartBuilder:
    def build(self, request: Record, data: Record) -> Record:
        kind = request["chart_type"]
        charts: list[Record] = []
        warnings = list(data.get("warnings", []))
        if kind in {"metric_bar", "epoch_line"}:
            groups: dict[tuple[str, str, str], list[Record]] = {}
            for row in data["metric_rows"]:
                if row["name"] != request["metric"] or row["stage"] != request["stage"]:
                    continue
                isolated = row["unit"] == "unknown" or row["granularity"] == "unknown"
                key = (row["unit"], row["granularity"], row["experiment_id"] if isolated else "")
                groups.setdefault(key, []).append(row)
            for key, rows in groups.items():
                series: list[Record] = []
                if kind == "metric_bar":
                    series = [
                        {
                            "id": request["metric"],
                            "label": request["metric"],
                            "points": [
                                {
                                    "x": row["experiment_id"],
                                    "y": row["value"],
                                    "experiment_id": row["experiment_id"],
                                }
                                for row in rows
                            ],
                        }
                    ]
                else:
                    for identity in dict.fromkeys(row["experiment_id"] for row in rows):
                        series.append(
                            {
                                "id": identity,
                                "label": identity,
                                "points": [
                                    {
                                        "x": row["epoch"],
                                        "y": row["value"],
                                        "experiment_id": identity,
                                    }
                                    for row in rows
                                    if row["experiment_id"] == identity and row["epoch"] is not None
                                ],
                            }
                        )
                charts.append(
                    chart(
                        ":".join((request["stage"], request["metric"], *key)),
                        "bar" if kind == "metric_bar" else "line",
                        f"{request['stage']} {request['metric']} ({key[1]})",
                        axis(
                            "Experiment" if kind == "metric_bar" else "Epoch",
                            None,
                            kind == "epoch_line",
                        ),
                        axis(request["metric"], key[0], True),
                        series,
                    )
                )
            if len(groups) > 1:
                warnings.append(
                    "Incompatible or unknown units and granularities are shown in separate charts"
                )
        elif kind == "prediction_scatter":
            for identity in request["experiment_ids"]:
                rows = [
                    row
                    for row in data["prediction_rows"]
                    if row["experiment_id"] == identity
                    and row["target"] is not None
                    and row["prediction"] is not None
                ]
                for granularity in dict.fromkeys(row["granularity"] for row in rows):
                    points = [
                        {
                            "x": row["target"],
                            "y": row["prediction"],
                            "experiment_id": identity,
                            "battery_id": row["battery_id"],
                        }
                        for row in rows
                        if row["granularity"] == granularity
                    ]
                    charts.append(
                        chart(
                            f"prediction:{identity}:{granularity}",
                            "scatter",
                            f"{identity} ({granularity})",
                            axis("Target", "unknown", True),
                            axis("Prediction", "unknown", True),
                            [{"id": identity, "label": identity, "points": points}],
                        )
                    )
            if not charts:
                raise DomainError(
                    "no_ground_truth", "No prediction has an available ground truth pair"
                )
        elif kind == "set_count_bar":
            points = [
                {"x": item["label"], "y": item["count"]} for item in data["statistics"]["counts"]
            ]
            charts.append(
                chart(
                    "set-count",
                    "bar",
                    "Battery count",
                    axis("Set", None, False),
                    axis("Count", "count", True),
                    [{"id": "count", "label": "Count", "points": points}],
                )
            )
        elif kind == "overlap_bar":
            points = [
                {"x": item["label"], "y": item["intersection"]}
                for item in data["statistics"]["pairs"]
            ]
            charts.append(
                chart(
                    "set-overlap",
                    "bar",
                    "Shared batteries",
                    axis("Pair", None, False),
                    axis("Count", "count", True),
                    [{"id": "intersection", "label": "Intersection", "points": points}],
                )
            )
        elif kind == "category_bar":
            series = [
                {
                    "id": item["set_id"],
                    "label": item["label"],
                    "points": [
                        {"x": category["label"], "y": category["count"]}
                        for category in item["categories"]
                    ],
                }
                for item in data["statistics"]["distributions"]
            ]
            charts.append(
                chart(
                    f"category:{request['category']}",
                    "bar",
                    request["category"],
                    axis(request["category"], None, False),
                    axis("Count", "count", True),
                    series,
                )
            )
        else:
            raise DomainError("unsupported_capability", "Chart type is not implemented")
        if not charts:
            warnings.append("No measurements match this chart request")
        return {
            "schema_version": 1,
            "provider_id": "basic-charts/v1",
            "charts": charts,
            "warnings": warnings,
        }
