"""Physical battery file discovery, feature extraction, and persistent feature cache."""

import hashlib
import os
import pickle
import warnings
from collections.abc import Callable
from pathlib import Path
from typing import cast

import numpy as np
import pandas as pd
from joblib import Parallel, delayed

from .features import FEATURE_VERSION, extract_cycle_features

ProgressCallback = Callable[[int, int, str], None]


def extract_file(path: Path, dataset: str, stride: int = 1) -> pd.DataFrame:
    with path.open("rb") as stream:
        value = pickle.load(stream)  # noqa: S301 -- indexed company-owned battery files only
    if not isinstance(value, dict):
        raise ValueError("顶层对象不是 dict")
    cycles = value.get("cycle_data")
    if not isinstance(cycles, (list, tuple)) or not cycles:
        raise ValueError("没有有效的 cycle_data")
    cell_id = str(value.get("cell_id", path.stem))
    try:
        nominal = float(value.get("nominal_capacity_in_Ah", np.nan))
    except (TypeError, ValueError):
        nominal = np.nan
    nominal = nominal if np.isfinite(nominal) and nominal > 0 else np.nan

    rows: list[dict[str, object]] = []
    for index, cycle in enumerate(cycles):
        if not isinstance(cycle, dict) or index % max(1, int(stride)):
            continue
        number = cycle.get("cycle_number", index + 1)
        row: dict[str, object] = {
            "dataset": dataset,
            "cell_uid": f"{dataset}/{path.stem}",
            "cell_id": cell_id,
            "file": path.name,
            "cycle_number": float(number) if number is not None else float(index + 1),
            "nominal_capacity_Ah": nominal,
        }
        row.update(extract_cycle_features(cycle, nominal))
        rows.append(row)
    return pd.DataFrame(rows)


def cache_file(cache_dir: Path, dataset: str, path: Path, stride: int) -> Path:
    stat = path.stat()
    key = hashlib.sha256(
        f"{path}|{stat.st_size}|{stat.st_mtime_ns}".encode()
    ).hexdigest()[:16]
    return cache_dir / f"v{FEATURE_VERSION}_s{stride}" / dataset / f"{path.stem}.{key}.pkl"


def cache_status(
    datasets: dict[str, list[Path]], selected: list[str], stride: int, cache_dir: Path
) -> dict[str, tuple[int, int]]:
    return {
        name: (
            sum(cache_file(cache_dir, name, path, stride).exists() for path in datasets.get(name, [])),
            len(datasets.get(name, [])),
        )
        for name in selected
    }


def _build_one(dataset: str, path: Path, stride: int, cache_dir: Path) -> tuple[str, str, str, str]:
    target = cache_file(cache_dir, dataset, path, stride)
    if target.exists():
        return dataset, path.name, "cached", ""
    try:
        frame = extract_file(path, dataset, stride)
        if frame.empty:
            raise ValueError("提取结果为空")
        target.parent.mkdir(parents=True, exist_ok=True)
        temporary = target.with_suffix(f".tmp{os.getpid()}")
        frame.to_pickle(temporary)
        os.replace(temporary, target)
        return dataset, path.name, "built", f"{len(frame)} cycles"
    except Exception as exc:  # noqa: BLE001 -- isolate failures to individual files
        return dataset, path.name, "failed", f"{type(exc).__name__}: {exc}"


def build_features(
    datasets: dict[str, list[Path]],
    selected: list[str],
    stride: int,
    cache_dir: Path,
    workers: int = 1,
    progress: ProgressCallback | None = None,
) -> dict[str, object]:
    tasks = [
        (name, path)
        for name in selected
        for path in datasets.get(name, [])
        if not cache_file(cache_dir, name, path, stride).exists()
    ]
    total = len(tasks)
    built = 0
    failed: list[tuple[str, str, str]] = []

    def handle(result: tuple[str, str, str, str], done: int) -> None:
        nonlocal built
        dataset, filename, state, message = result
        if state == "built":
            built += 1
        elif state == "failed":
            failed.append((dataset, filename, message))
        if progress:
            progress(done, total, f"{dataset}/{filename}")

    if workers <= 1:
        for done, (name, path) in enumerate(tasks, 1):
            handle(_build_one(name, path, stride, cache_dir), done)
    elif tasks:
        generated = Parallel(
            n_jobs=workers, backend="loky", return_as="generator_unordered"
        )(
            delayed(_build_one)(name, path, stride, cache_dir)
            for name, path in tasks
        )
        for done, result in enumerate(generated, 1):
            handle(result, done)
    return {"built": built, "failed": failed, "total": total}


def load_features(
    datasets: dict[str, list[Path]], selected: list[str], stride: int, cache_dir: Path
) -> pd.DataFrame:
    parts: list[pd.DataFrame] = []
    for name in selected:
        for path in datasets.get(name, []):
            target = cache_file(cache_dir, name, path, stride)
            if not target.exists():
                continue
            try:
                parts.append(
                    cast(
                        pd.DataFrame,
                        pd.read_pickle(target),  # noqa: S301 -- cache created by this service
                    )
                )
            except Exception as exc:  # noqa: BLE001
                warnings.warn(f"缓存损坏，已跳过 {target}: {exc}", stacklevel=2)
    return pd.concat(parts, ignore_index=True) if parts else pd.DataFrame()
