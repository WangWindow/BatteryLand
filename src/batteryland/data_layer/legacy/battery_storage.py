"""Read original BatteryLife pickles and our display-only quantized XZ copies.

Only use this module with trusted files: both formats contain Python pickle data.
The BLQ1 representation preserves metadata and cycle numbers, while rounding
sampled signals. It is not a scientific or archival replacement for the source.
"""

from __future__ import annotations

import lzma
import os
import pickle
from pathlib import Path

import numpy as np


MAGIC = "BatteryLife-display-BLQ1"
SUFFIX = ".pkl.xz"
STEPS = {
    "time_in_s": 0.1,
    "voltage_in_V": 0.0001,
    "current_in_A": 0.0001,
    "charge_capacity_in_Ah": 0.000001,
    "discharge_capacity_in_Ah": 0.000001,
    "temperature_in_C": 0.01,
}


def logical_name(path: Path) -> str:
    """Keep the original .pkl identity for labels, links, and catalog keys."""
    name = path.name
    if name.endswith(SUFFIX):
        return name[:-3]
    if name.endswith(".pkl"):
        return name
    raise ValueError(f"Not a BatteryLife cell file: {name}")


def cell_files(folder: Path):
    """Yield one file per logical cell, preferring the original if both exist."""
    paths = {logical_name(path): path for path in folder.glob(f"*{SUFFIX}")}
    paths.update({path.name: path for path in folder.glob("*.pkl")})
    for name in sorted(paths):
        yield paths[name]


def resolve_cell_path(root: Path, source: str, name: str) -> Path:
    if Path(name).name != name or not name.endswith(".pkl"):
        raise ValueError("Invalid logical cell name")
    folder = root / source
    original = folder / name
    if original.is_file():
        return original
    compressed = folder / f"{name}.xz"
    if compressed.is_file():
        return compressed
    raise FileNotFoundError(original)


def _encode_series(values, step):
    if not isinstance(values, (list, tuple, np.ndarray)) or not len(values):
        return values, False
    try:
        array = np.asarray(values)
    except (TypeError, ValueError, OverflowError):
        return values, False
    if array.ndim != 1 or array.dtype.kind not in "fiu":
        return values, False
    array = array.astype(np.float64)
    if not np.all(np.isfinite(array)):
        return values, False
    scaled = array / step
    if not np.all(np.abs(scaled) < 2**62):
        return values, False
    rounded = np.rint(scaled).astype("<i8")
    first = int(rounded[0])
    deltas = np.diff(rounded)
    if len(deltas) and np.max(np.abs(deltas)) < 2**31:
        code = "i4"
        payload = deltas.astype("<i4").tobytes()
    else:
        code = "i8"
        payload = deltas.astype("<i8").tobytes()
    return (len(rounded), first, code, payload), True


def _decode_series(value, step):
    count, first, code, payload = value
    if not isinstance(count, int) or count < 1 or code not in ("i4", "i8"):
        raise ValueError("Invalid BLQ1 series header")
    width = 4 if code == "i4" else 8
    if len(payload) != (count - 1) * width:
        raise ValueError("Invalid BLQ1 series length")
    delta = np.frombuffer(payload, dtype=f"<{code}").astype(np.int64)
    numbers = np.empty(count, dtype=np.int64)
    numbers[0] = first
    numbers[1:] = delta
    np.cumsum(numbers, out=numbers)
    return (numbers.astype(np.float64) * step).tolist()


def load_cell(path: Path):
    """Return the same nested dictionary shape the Web app already consumes."""
    if path.name.endswith(SUFFIX):
        with lzma.open(path, "rb") as stream:
            magic, data = pickle.load(stream)
        if magic != MAGIC:
            raise ValueError(f"Unsupported compressed BatteryLife format: {path}")
        for cycle in data["cycle_data"]:
            for field, step in STEPS.items():
                value = cycle.get(field)
                if isinstance(value, dict) and "__blq1__" in value:
                    cycle[field] = _decode_series(value["__blq1__"], step)
        return data
    with path.open("rb") as stream:
        return pickle.load(stream)


def write_compressed(data: dict, destination: Path, preset: int = 3):
    """Encode an already-loaded cell; caller writes only to a new output tree."""
    if not isinstance(data, dict) or not isinstance(data.get("cycle_data"), list):
        raise ValueError("Expected BatteryLife cycle_data list")
    if destination.exists():
        raise FileExistsError(destination)
    encoded = 0
    for cycle in data["cycle_data"]:
        if not isinstance(cycle, dict):
            continue
        for field, step in STEPS.items():
            if field not in cycle:
                continue
            value, changed = _encode_series(cycle[field], step)
            if changed:
                cycle[field] = {"__blq1__": value}
                encoded += 1
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_name(destination.name + ".tmp")
    try:
        with lzma.open(temporary, "wb", preset=preset) as stream:
            pickle.dump((MAGIC, data), stream, protocol=pickle.HIGHEST_PROTOCOL)
        os.replace(temporary, destination)
    finally:
        temporary.unlink(missing_ok=True)
    return encoded
