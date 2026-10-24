"""Pure metadata summaries for immutable logical dataset versions."""

import json
import math
from collections import Counter
from typing import Any


def _numeric(value: Any) -> float | None:
    if type(value) not in {int, float}:
        return None
    try:
        number = float(value)
    except OverflowError:
        return None
    return number if math.isfinite(number) else None


def _category(value: Any) -> tuple[str, str] | None:
    if isinstance(value, str):
        value_type = "string"
    elif type(value) is bool:
        value_type = "boolean"
    elif type(value) is int:
        value_type = "integer"
    elif type(value) is float and math.isfinite(value):
        value_type = "number"
    else:
        return None
    encoded = json.dumps(value, ensure_ascii=False, allow_nan=False, sort_keys=True)
    return value_type, encoded


def _attribute_summary(values: list[Any], sample_count: int) -> dict[str, Any]:
    present = [value for value in values if value is not None]
    missing_count = sample_count - len(present)
    numeric_field = bool(present) and all(type(value) in {int, float} for value in present)

    if numeric_field:
        numbers = [number for value in present if (number := _numeric(value)) is not None]
        summary: dict[str, Any] = {
            "kind": "numeric",
            "valid_count": len(numbers),
            "missing_count": missing_count,
            "unsupported_count": len(present) - len(numbers),
        }
        if numbers:
            summary.update(
                min=min(numbers),
                max=max(numbers),
                mean=math.fsum(value / len(numbers) for value in numbers),
            )
        return summary

    categories: Counter[tuple[str, str]] = Counter()
    for value in present:
        category = _category(value)
        if category is not None:
            categories[category] += 1
    return {
        "kind": "categorical",
        "valid_count": sum(categories.values()),
        "missing_count": missing_count,
        "unsupported_count": len(present) - sum(categories.values()),
        "categories": [
            {"value_type": value_type, "value": json.loads(encoded), "count": count}
            for (value_type, encoded), count in sorted(categories.items())
        ],
    }


def _scope(member_ids: list[str], metadata_by_id: dict[str, dict[str, Any]]) -> dict[str, Any]:
    metadata = [metadata_by_id.get(identity, {}) for identity in member_ids]
    fields = sorted(
        {name for attributes in metadata for name in attributes if isinstance(name, str)}
    )
    return {
        "sample_count": len(member_ids),
        "attributes": {
            name: _attribute_summary(
                [attributes.get(name) for attributes in metadata], len(metadata)
            )
            for name in fields
        },
    }


def summarize_dataset(
    partitions: dict[str, list[str]], metadata_by_id: dict[str, dict[str, Any]]
) -> dict[str, Any]:
    """Summarize scalar battery metadata for the full set and each partition."""
    all_ids = list(
        dict.fromkeys(member for name in ("train", "val", "test") for member in partitions[name])
    )
    ids_by_scope = {"all": all_ids, **{name: partitions[name] for name in ("train", "val", "test")}}
    return {
        "schema_version": 1,
        "scopes": {
            name: _scope(member_ids, metadata_by_id) for name, member_ids in ids_by_scope.items()
        },
    }
