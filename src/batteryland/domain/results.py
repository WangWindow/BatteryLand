"""Normalize provider values without inventing missing measurements or units."""

import math
from typing import Any

from batteryland.domain.errors import DomainError


def number(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise DomainError("invalid_input", "Measurements must be finite numbers or null")
    return float(value)


def normalize_metrics(value: dict[str, Any], config: dict[str, Any]) -> list[dict[str, Any]]:
    epoch = value.get("epoch")
    if epoch is not None and (type(epoch) is not int or epoch < 0):
        raise DomainError("invalid_input", "Epoch must be a nonnegative integer")
    units = value.get("units", {})
    if not isinstance(units, dict) or any(not isinstance(unit, str) for unit in units.values()):
        raise DomainError("invalid_input", "Metric units must be a string mapping")
    known: dict[str, str] = {}
    specs = config.get("metric", [])
    for spec in specs if isinstance(specs, list) else [specs]:
        if not isinstance(spec, dict):
            continue
        name = spec.get("name", spec.get("type"))
        kind = str(spec.get("type", "")).lower()
        if isinstance(name, str):
            unit = {"mape": "ratio", "accuracy": "percent"}.get(kind, "unknown")
            for prefix in ("", "seen_", "unseen_"):
                known[prefix + name] = unit
    task = config.get("task", {})
    granularity = value.get(
        "metric_granularity",
        "window" if isinstance(task, dict) and task.get("type") == "BatteryLifeRun" else "unknown",
    )
    if not isinstance(granularity, str):
        raise DomainError("invalid_input", "Metric granularity must be a string")
    result = []
    for stage in ("train", "validation", "test"):
        metrics = value.get(stage)
        if metrics is None:
            continue
        if not isinstance(metrics, dict):
            raise DomainError("invalid_input", "Stage metrics must be an object")
        for name, measurement in metrics.items():
            result.append(
                {
                    "epoch": epoch,
                    "stage": stage,
                    "name": name,
                    "value": number(measurement),
                    "unit": units.get(name, known.get(name, "unknown")),
                    "granularity": granularity,
                }
            )
    return result
