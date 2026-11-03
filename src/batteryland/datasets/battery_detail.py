"""Read a registered BatteryLife cell for on-demand, read-only exploration.

Only administrator-configured source roots are eligible. Pickle is executable, so
this service must never be used for an uploaded or browser-supplied file path.
"""

import json
import math
import os
import pickle
import re
import threading
from collections import OrderedDict
from pathlib import Path
from typing import Any

from batteryland.common.errors import DomainError
from batteryland.common.storage import contained_path
from batteryland.config import Settings
from batteryland.db.contracts import UnitOfWorkFactory

METADATA_FIELDS = (
    "cell_id",
    "reference",
    "description",
    "form_factor",
    "cathode_material",
    "anode_material",
    "electrolyte_material",
    "nominal_capacity_in_Ah",
    "charge_protocol",
    "discharge_protocol",
    "SOC_interval",
    "depth_of_charge",
    "depth_of_discharge",
    "already_spent_cycles",
    "min_voltage_limit_in_V",
    "max_voltage_limit_in_V",
    "min_current_limit_in_A",
    "max_current_limit_in_A",
)
SAMPLE_FIELDS = (
    "time_in_s",
    "voltage_in_V",
    "current_in_A",
    "charge_capacity_in_Ah",
    "discharge_capacity_in_Ah",
    "temperature_in_C",
)


def finite_number(value: Any) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        number = float(value)
    except TypeError, ValueError, OverflowError:
        return None
    return number if math.isfinite(number) else None


def cycle_number(value: Any) -> int | None:
    number = finite_number(value)
    return int(number) if number is not None and number.is_integer() else None


def max_finite(values: Any) -> float | None:
    if values is None:
        return None
    try:
        numbers = (finite_number(value) for value in values)
        return max((value for value in numbers if value is not None), default=None)
    except TypeError, ValueError:
        return None


def json_value(value: Any, depth: int = 0) -> Any:
    if depth > 8:
        return str(value)
    if value is None or isinstance(value, (str, bool, int)):
        return value
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    if hasattr(value, "item"):
        try:
            return json_value(value.item(), depth + 1)
        except TypeError, ValueError, OverflowError:
            pass
    if isinstance(value, dict):
        return {str(key): json_value(item, depth + 1) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [json_value(item, depth + 1) for item in value[:1000]]
    if hasattr(value, "tolist"):
        return json_value(value.tolist(), depth + 1)
    return str(value)


class BatteryDetailService:
    """Preserve BatteryLand UUIDs while reading their trusted source files."""

    def __init__(self, settings: Settings, units: UnitOfWorkFactory) -> None:
        self.settings = settings
        self.units = units
        self._lock = threading.RLock()
        self._raw_key: tuple[Path, int, int] | None = None
        self._raw_data: dict[str, Any] | None = None
        self._summaries: OrderedDict[tuple[Path, int, int], dict[str, Any]] = OrderedDict()

    def _registered_file(
        self, battery_id: str
    ) -> tuple[dict[str, Any], dict[str, Any], Path, tuple[Path, int, int]]:
        with self.units() as unit:
            battery = unit.resources.get_battery(battery_id)
            source = unit.resources.get_source(battery["source_id"])
        if battery["availability"] != "available" or source["availability"] != "available":
            raise DomainError("not_found", "Battery file is unavailable")
        root = self.settings.source_roots.get(source["root_alias"])
        if root is None or not battery["relative_key"].lower().endswith(".pkl"):
            raise DomainError("invalid_input", "Battery is not in a supported source root")
        try:
            path = contained_path(root, battery["relative_key"])
            if not path.is_file() or not os.access(path, os.R_OK):
                raise DomainError("not_found", "Battery file is unavailable")
            stat = path.stat()
        except OSError as exc:
            raise DomainError("not_found", "Battery file is unavailable") from exc
        return battery, source, path, (path, stat.st_mtime_ns, stat.st_size)

    def _raw(self, key: tuple[Path, int, int]) -> dict[str, Any]:
        with self._lock:
            if key == self._raw_key and self._raw_data is not None:
                return self._raw_data
            path = key[0]
            try:
                with path.open("rb") as stream:
                    data = pickle.load(stream)
                stat = path.stat()
            except Exception as exc:
                raise DomainError("storage_corrupt", "Battery file could not be read") from exc
            if (stat.st_mtime_ns, stat.st_size) != key[1:]:
                raise DomainError("conflict", "Battery file changed while it was being read")
            if not isinstance(data, dict) or not isinstance(data.get("cycle_data"), list):
                raise DomainError("storage_corrupt", "Battery file has no valid cycle_data list")
            self._raw_key, self._raw_data = key, data
            return data

    def _summary(self, key: tuple[Path, int, int]) -> dict[str, Any]:
        with self._lock:
            cached = self._summaries.get(key)
            if cached is not None:
                self._summaries.move_to_end(key)
                return cached
            data = self._raw(key)
            cycles = []
            for index, cycle in enumerate(data["cycle_data"]):
                values = cycle if isinstance(cycle, dict) else {}
                cycles.append(
                    {
                        "index": index,
                        "number": cycle_number(values.get("cycle_number")),
                        "discharge_capacity_ah": max_finite(values.get("discharge_capacity_in_Ah")),
                        "charge_capacity_ah": max_finite(values.get("charge_capacity_in_Ah")),
                    }
                )
            baseline = next(
                (
                    row["discharge_capacity_ah"]
                    for row in cycles
                    if row["discharge_capacity_ah"] is not None and row["discharge_capacity_ah"] > 0
                ),
                None,
            )
            for row in cycles:
                value = row["discharge_capacity_ah"]
                row["relative_capacity_percent"] = (
                    100 * value / baseline if value is not None and baseline is not None else None
                )
            recorded = [row["number"] for row in cycles if row["number"] is not None]
            result = {
                "metadata": {field: json_value(data.get(field)) for field in METADATA_FIELDS},
                "cycle_count": len(cycles),
                "first_recorded_cycle": recorded[0] if recorded else None,
                "last_recorded_cycle": recorded[-1] if recorded else None,
                "max_recorded_cycle": max(recorded) if recorded else None,
                "first_valid_discharge_ah": baseline,
                "cycles": cycles,
            }
            self._summaries[key] = result
            while len(self._summaries) > 8:
                self._summaries.popitem(last=False)
            return result

    @staticmethod
    def _life_label(
        root: Path, source_name: str, file_name: str
    ) -> tuple[float | None, str | None]:
        folder = root / "Life labels"
        if not folder.is_dir():
            return None, None
        candidate = (
            re.sub(r"--(\d+)\.pkl$", r"-#\1.pkl", file_name)
            if source_name == "Tongji"
            else file_name
        )
        found: tuple[float | None, str | None] = (None, None)
        try:
            for label_file in sorted(folder.glob("*.json")):
                labels = json.loads(label_file.read_text(encoding="utf-8"))
                if not isinstance(labels, dict):
                    continue
                key = file_name if file_name in labels else candidate
                if key in labels:
                    found = finite_number(labels[key]), label_file.name
        except (OSError, ValueError) as exc:
            raise DomainError(
                "storage_corrupt", "Battery life-label file could not be read"
            ) from exc
        return found

    def summary(self, battery_id: str) -> dict[str, Any]:
        battery, source, _path, key = self._registered_file(battery_id)
        summary = self._summary(key)
        source_name = Path(source["group_prefix"]).name or source["name"]
        label, label_file = self._life_label(
            self.settings.source_roots[source["root_alias"]], source_name, battery["file_name"]
        )
        return {
            "battery_id": battery_id,
            "source_id": source["id"],
            "source_name": source["name"],
            "file_name": battery["file_name"],
            "registered_metadata": battery["metadata"],
            "life_label": label,
            "life_label_file": label_file,
            **summary,
        }

    def cycle(self, battery_id: str, index: int) -> dict[str, Any]:
        _battery, _source, _path, key = self._registered_file(battery_id)
        data = self._raw(key)
        cycles = data["cycle_data"]
        if index < 0 or index >= len(cycles):
            raise DomainError("not_found", "Cycle record does not exist")
        cycle = cycles[index]
        if not isinstance(cycle, dict):
            raise DomainError("storage_corrupt", "Cycle record is invalid")
        fields = {name: cycle.get(name) for name in SAMPLE_FIELDS}
        try:
            point_count = max(
                (len(values) for values in fields.values() if values is not None), default=0
            )
        except TypeError as exc:
            raise DomainError("storage_corrupt", "Cycle sample arrays are invalid") from exc
        if point_count == 0:
            return {
                "index": index,
                "number": cycle_number(cycle.get("cycle_number")),
                "point_count": 0,
                "sample_indices": [],
                "duration_min": None,
                "time_unit": "sample",
                "points": [],
            }
        if point_count <= 1800:
            selected = list(range(point_count))
        else:
            selected = [round(position * (point_count - 1) / 1799) for position in range(1800)]
        times = fields["time_in_s"]
        valid_time = times is not None and len(times) == point_count
        first_time = finite_number(times[0]) if valid_time else None
        last_time = finite_number(times[-1]) if valid_time else None
        points = []
        for position in selected:
            time = finite_number(times[position]) if valid_time else None
            if first_time is None:
                x = position
            else:
                x = (time - first_time) / 60 if time is not None else None
            row = [x]
            for field in SAMPLE_FIELDS[1:]:
                values = fields[field]
                row.append(
                    finite_number(values[position])
                    if values is not None and position < len(values)
                    else None
                )
            points.append(row)
        return {
            "index": index,
            "number": cycle_number(cycle.get("cycle_number")),
            "point_count": point_count,
            "sample_indices": selected,
            "duration_min": (last_time - first_time) / 60
            if first_time is not None and last_time is not None and last_time >= first_time
            else None,
            "time_unit": "min" if first_time is not None else "sample",
            "points": points,
        }
