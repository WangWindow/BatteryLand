"""Original BatteryLife metadata and Cycle calculations for trusted source files."""

from __future__ import annotations

import json
import math
import re
import threading
from collections import OrderedDict
from pathlib import Path

from .battery_storage import cell_files, load_cell, logical_name
from .incremental_capacity import incremental_capacity

META_FIELDS = (
    "form_factor",
    "anode_material",
    "cathode_material",
    "electrolyte_material",
    "nominal_capacity_in_Ah",
    "charge_protocol",
    "discharge_protocol",
    "SOC_interval",
    "max_voltage_limit_in_V",
    "min_voltage_limit_in_V",
)


def finite_number(value):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def max_finite(values):
    if values is None:
        return None
    try:
        iterator = iter(values)
    except TypeError:
        return None
    result = None
    for value in iterator:
        number = finite_number(value)
        if number is not None and (result is None or number > result):
            result = number
    return result


def finite_extrema(values):
    """Measure the complete original sequence, independent of plot sampling."""
    if values is None or isinstance(values, (str, bytes, dict)):
        return {"count": 0, "min": None, "max": None}
    try:
        iterator = iter(values)
    except TypeError:
        return {"count": 0, "min": None, "max": None}
    count, low, high = 0, None, None
    for raw in iterator:
        value = finite_number(raw)
        if value is None:
            continue
        count += 1
        low = value if low is None else min(low, value)
        high = value if high is None else max(high, value)
    return {"count": count, "min": low, "max": high}


def cycle_features(fields):
    measures = {
        key: finite_extrema(fields.get(key))
        for key in ("voltage_in_V", "current_in_A", "temperature_in_C",
                    "discharge_capacity_in_Ah", "charge_capacity_in_Ah")
    }
    voltage, current = measures["voltage_in_V"], measures["current_in_A"]
    temperature = measures["temperature_in_C"]
    discharge, charge = measures["discharge_capacity_in_Ah"], measures["charge_capacity_in_Ah"]
    return {
        "basis": "all_original_samples",
        "voltage_valid_points": voltage["count"],
        "voltage_min_V": voltage["min"], "voltage_max_V": voltage["max"],
        "voltage_span_V": voltage["max"] - voltage["min"] if voltage["count"] >= 2 else None,
        "current_valid_points": current["count"],
        "current_abs_peak_A": max(abs(current["min"]), abs(current["max"])) if current["count"] else None,
        "temperature_valid_points": temperature["count"],
        "temperature_min_C": temperature["min"], "temperature_max_C": temperature["max"],
        "temperature_span_C": temperature["max"] - temperature["min"] if temperature["count"] >= 2 else None,
        "discharge_capacity_valid_points": discharge["count"],
        "max_discharge_capacity_Ah": discharge["max"],
        "charge_capacity_valid_points": charge["count"],
        "max_charge_capacity_Ah": charge["max"],
    }


def json_value(value):
    if value is None or isinstance(value, (str, bool, int)):
        return value
    if isinstance(value, float):
        return finite_number(value)
    if isinstance(value, (list, tuple)):
        return [json_value(item) for item in value]
    if hasattr(value, "item"):
        return json_value(value.item())
    return str(value)


class BatteryDataset:
    def __init__(self, root: Path):
        self.root = root.resolve()
        label_dir = self.root / "Life labels"
        if not self.root.is_dir() or not label_dir.is_dir():
            raise ValueError(f"找不到 BatteryLife 数据集或 Life labels 目录：{self.root}")

        labels = {}
        for path in sorted(label_dir.glob("*.json")):
            with path.open("r", encoding="utf-8") as stream:
                labels.update(json.load(stream))

        self.paths = {}
        self.catalogue = {}
        for folder in sorted(self.root.iterdir()):
            if not folder.is_dir() or folder.name in {"Life labels", "seen_unseen_labels", "total_MICH"}:
                continue
            cells = []
            for path in cell_files(folder):
                name = logical_name(path)
                key = (folder.name, name)
                self.paths[key] = path
                label_key = name
                if folder.name == "Tongji":
                    # The provided label JSON uses -#N, whereas processed files use --N.
                    label_key = re.sub(r"--(\d+)\.pkl$", r"-#\1.pkl", name)
                label = labels.get(name, labels.get(label_key))
                cells.append({
                    "name": name,
                    "label": finite_number(label),
                    "size_mb": round(path.stat().st_size / 1024**2, 1),
                })
            if cells:
                self.catalogue[folder.name] = cells

        self._raw_key = None
        self._raw_data = None
        self._summaries = OrderedDict()
        self._lock = threading.RLock()

    def catalog(self):
        return {"sources": self.catalogue, "root": str(self.root)}

    def _path(self, source: str, cell: str) -> Path:
        try:
            return self.paths[(source, cell)]
        except KeyError as exc:
            raise KeyError("未找到这块电池") from exc

    def _label(self, source: str, cell: str):
        return next(item["label"] for item in self.catalogue[source] if item["name"] == cell)

    def raw(self, source: str, cell: str):
        key = (source, cell)
        path = self._path(*key)
        with self._lock:
            if self._raw_key != key:
                data = load_cell(path)
                if not isinstance(data, dict) or not isinstance(data.get("cycle_data"), list):
                    raise ValueError("电池文件不符合预期的 BatteryLife 格式")
                self._raw_key, self._raw_data = key, data
            return self._raw_data

    def summary(self, source: str, cell: str):
        key = (source, cell)
        self._path(*key)
        with self._lock:
            if key in self._summaries:
                self._summaries.move_to_end(key)
                return self._summaries[key]

        data = self.raw(*key)
        cycles = []
        for index, cycle in enumerate(data["cycle_data"]):
            number = finite_number(cycle.get("cycle_number"))
            cycles.append([
                int(number) if number is not None else index + 1,
                max_finite(cycle.get("discharge_capacity_in_Ah")),
                max_finite(cycle.get("charge_capacity_in_Ah")),
            ])

        first_discharge = next((row[1] for row in cycles if row[1] is not None and row[1] > 0), None)
        nominal = finite_number(data.get("nominal_capacity_in_Ah"))
        soc = data.get("SOC_interval")
        soc_width = None
        if isinstance(soc, (list, tuple)) and len(soc) >= 2:
            start, stop = finite_number(soc[0]), finite_number(soc[1])
            if start is not None and stop is not None and stop > start:
                soc_width = stop - start
        nominal_window = nominal * soc_width if nominal is not None and soc_width is not None else None

        result = {
            "source": source,
            "name": cell,
            "label": self._label(source, cell),
            "cycle_count": len(cycles),
            "cycles": cycles,
            "first_discharge_ah": first_discharge,
            "nominal_window_ah": nominal_window,
            "metadata": {field: json_value(data.get(field)) for field in META_FIELDS},
        }
        with self._lock:
            self._summaries[key] = result
            self._summaries.move_to_end(key)
            while len(self._summaries) > 8:
                self._summaries.popitem(last=False)
        return result

    def cycle(self, source: str, cell: str, index: int):
        data = self.raw(source, cell)
        cycles = data["cycle_data"]
        if index < 0 or index >= len(cycles):
            raise ValueError("cycle 序号超出范围")
        cycle = cycles[index]
        field_names = (
            "time_in_s", "voltage_in_V", "current_in_A",
            "charge_capacity_in_Ah", "discharge_capacity_in_Ah", "temperature_in_C",
        )
        fields = {name: cycle.get(name) for name in field_names}
        features = cycle_features(fields)
        point_count = max((len(v) for v in fields.values() if hasattr(v, "__len__")), default=0)
        if point_count == 0:
            return {"index": index, "number": json_value(cycle.get("cycle_number", index + 1)),
                    "point_count": 0, "sample_indices": [], "duration_min": None,
                    "points": [], "time_unit": "sample", "features": features}

        # Uniform sampling keeps the browser responsive on unusually long cycles.
        step = max(1, math.ceil(point_count / 1800))
        selected = list(range(0, point_count, step))
        if selected[-1] != point_count - 1:
            selected.append(point_count - 1)
        times = fields["time_in_s"]
        valid_time = times is not None and len(times) == point_count
        first_time = finite_number(times[0]) if valid_time else None
        last_time = finite_number(times[-1]) if valid_time else None
        duration_min = ((last_time - first_time) / 60 if first_time is not None
                        and last_time is not None and last_time >= first_time else None)
        points = []
        for i in selected:
            t = finite_number(times[i]) if valid_time else None
            x = ((t - first_time) / 60 if t is not None else None) if first_time is not None else i
            row = [x]
            for name in field_names[1:]:
                values = fields[name]
                row.append(finite_number(values[i]) if values is not None and i < len(values) else None)
            points.append(row)
        return {
            "index": index,
            "number": json_value(cycle.get("cycle_number", index + 1)),
            "point_count": point_count,
            "sample_indices": selected,
            "duration_min": duration_min,
            "time_unit": "min" if first_time is not None else "sample",
            "points": points,
            "features": features,
        }

    def incremental_capacity(self, source: str, cell: str, index: int):
        cycles = self.raw(source, cell)["cycle_data"]
        if index < 0 or index >= len(cycles):
            raise ValueError("cycle 序号超出范围")
        cycle = cycles[index]
        return {"index": index, "number": json_value(cycle.get("cycle_number", index + 1)),
                **incremental_capacity(cycle)}
