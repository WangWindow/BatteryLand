"""Read indexed battery files and derive cycle-level SOH curves."""

import math
import pickle
from pathlib import Path, PurePosixPath

import numpy as np

from batteryland.common.errors import DomainError
from batteryland.common.storage import contained_path
from batteryland.config import Settings
from batteryland.db.contracts import Record, UnitOfWorkFactory


class SingleModelService:
    def __init__(self, settings: Settings, units: UnitOfWorkFactory) -> None:
        self.settings = settings
        self.units = units

    def soh_curves(self, dataset_name: str, file_names: list[str], max_points: int) -> Record:
        requested = list(dict.fromkeys(file_names))
        source = self._find_source(dataset_name)
        if source is None:
            return {
                "source_name": dataset_name,
                "items": [],
                "warnings": [f"未找到数据集 {dataset_name}，无法读取 SOH 曲线。"],
            }

        with self.units() as unit:
            batteries = unit.resources.list_batteries(
                {"source_id": source["id"], "availability": "available"}, 1, 100000
            )["items"]
        by_name = {str(item["file_name"]): item for item in batteries}
        root = self.settings.source_roots.get(str(source["root_alias"]))
        if root is None:
            return {
                "source_name": source["name"],
                "items": [],
                "warnings": [f"数据集 {source['name']} 的根目录未配置。"],
            }

        items: list[Record] = []
        warnings: list[str] = []
        for file_name in requested:
            battery = by_name.get(file_name)
            if battery is None:
                warnings.append(f"{file_name}：未在数据集 {source['name']} 中找到。")
                continue
            try:
                path = contained_path(root, str(battery["relative_key"]))
                points, cell_id = self._read_curve(path, max_points)
            except (DomainError, OSError, ValueError, pickle.UnpicklingError) as exc:
                warnings.append(f"{file_name}：{exc}")
                continue
            items.append(
                {
                    "battery_id": str(battery["id"]),
                    "file_name": file_name,
                    "cell_id": cell_id,
                    "points": points,
                }
            )
        return {"source_name": source["name"], "items": items, "warnings": warnings}

    def _find_source(self, dataset_name: str) -> Record | None:
        wanted = dataset_name.strip().casefold()
        if not wanted:
            return None
        with self.units() as unit:
            sources = unit.resources.list_sources(1, 100000)["items"]

        def names(source: Record) -> set[str]:
            prefix = str(source.get("group_prefix") or "")
            return {
                str(source.get("name") or "").casefold(),
                prefix.casefold(),
                PurePosixPath(prefix).name.casefold() if prefix else "",
            }

        matches = [source for source in sources if wanted in names(source)]
        available = [source for source in matches if source.get("availability") == "available"]
        return available[0] if len(available) == 1 else None

    @staticmethod
    def _read_curve(path: Path, max_points: int) -> tuple[list[dict[str, float]], str]:
        with path.open("rb") as stream:
            value = pickle.load(stream)  # noqa: S301 -- indexed company-owned battery files only
        if not isinstance(value, dict):
            raise ValueError("电池文件顶层对象不是 dict")
        cycles = value.get("cycle_data")
        if not isinstance(cycles, (list, tuple)) or not cycles:
            raise ValueError("电池文件没有有效的 cycle_data")

        capacities: list[tuple[float, float]] = []
        for index, cycle in enumerate(cycles):
            if not isinstance(cycle, dict):
                continue
            raw_capacity = cycle.get("discharge_capacity_in_Ah")
            try:
                values = np.asarray(raw_capacity, dtype=float).reshape(-1)
            except TypeError, ValueError:
                continue
            finite = values[np.isfinite(values)]
            if not finite.size:
                continue
            capacity = float(np.max(finite))
            if not math.isfinite(capacity) or capacity <= 0:
                continue
            # Training labels use the position in the processed cycle_data array.
            # Do the same here instead of mixing in a dataset-specific raw cycle id.
            capacities.append((float(index + 1), capacity))
        if not capacities:
            raise ValueError("没有可用于计算 SOH 的放电容量")

        raw_nominal_capacity = value.get("nominal_capacity_in_Ah")
        try:
            nominal_capacity = float(raw_nominal_capacity)
        except TypeError, ValueError:
            nominal_capacity = math.nan
        baseline = (
            nominal_capacity
            if math.isfinite(nominal_capacity) and nominal_capacity > 0
            else capacities[0][1]
        )
        points = [{"cycle": cycle, "soh": capacity / baseline} for cycle, capacity in capacities]
        points = SingleModelService._smooth_curve(points)
        if len(points) > max_points:
            indices = np.linspace(0, len(points) - 1, num=max_points, dtype=int)
            points = [points[int(index)] for index in np.unique(indices)]
        return points, str(value.get("cell_id") or path.stem)

    @staticmethod
    def _smooth_curve(
        points: list[dict[str, float]],
    ) -> list[dict[str, float]]:
        """Remove narrow SOH spikes while preserving sustained degradation trends."""
        if len(points) < 3:
            return points
        values = [dict(point) for point in points]
        original = [point["soh"] for point in points]
        for index in range(1, len(points) - 1):
            previous = points[index - 1]
            current = points[index]
            following = points[index + 1]
            cycle_span = following["cycle"] - previous["cycle"]
            if cycle_span <= 0:
                expected = (original[index - 1] + original[index + 1]) / 2
            else:
                position = (current["cycle"] - previous["cycle"]) / cycle_span
                expected = original[index - 1] + position * (
                    original[index + 1] - original[index - 1]
                )
            neighbour_change = abs(original[index + 1] - original[index - 1])
            threshold = max(0.03, 2 * neighbour_change)
            if abs(original[index] - expected) > threshold:
                values[index]["soh"] = expected

        window = min(7, len(values) if len(values) % 2 else len(values) - 1)
        if window < 3:
            return values
        half = window // 2
        cleaned = np.asarray([point["soh"] for point in values], dtype=float)
        padded = np.pad(cleaned, (half, half), mode="edge")
        for index, point in enumerate(values):
            point["soh"] = float(np.median(padded[index : index + window]))
        return values
