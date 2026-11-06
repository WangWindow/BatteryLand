"""Portable feature frames shared by the API and isolated training interpreter."""

import os
import tempfile
from pathlib import Path

import numpy as np
import pandas as pd

CACHE_FORMAT_VERSION = 1


def save_frame(path: Path, frame: pd.DataFrame) -> None:
    """Store numeric and Unicode arrays, never Pandas/Arrow objects or object pickles."""
    columns = list(frame.columns)
    if (
        frame.empty
        or any(not isinstance(name, str) for name in columns)
        or len(set(columns)) != len(columns)
    ):
        raise ValueError("特征缓存必须包含非空数据及唯一的字符串列名")
    arrays = {
        "format_version": np.asarray(CACHE_FORMAT_VERSION),
        "columns": np.asarray(columns, dtype=str),
    }
    for index, name in enumerate(columns):
        series = frame[name]
        if pd.api.types.is_numeric_dtype(series.dtype) or pd.api.types.is_bool_dtype(series.dtype):
            values = series.to_numpy()
            if values.dtype.kind not in "biuf":
                values = series.to_numpy(dtype=float, na_value=np.nan)
        else:
            missing = series.isna().to_numpy(dtype=bool)
            values = np.asarray(
                [
                    "" if absent else str(value)
                    for value, absent in zip(series, missing, strict=True)
                ],
                dtype=str,
            )
            arrays[f"missing_{index}"] = missing
        arrays[f"column_{index}"] = values
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="wb", dir=path.parent, prefix=f".{path.name}.", suffix=".tmp", delete=False
        ) as stream:
            temporary = Path(stream.name)
            np.savez_compressed(stream, allow_pickle=False, **arrays)
        os.replace(temporary, path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def load_frame(path: Path) -> pd.DataFrame:
    with np.load(path, allow_pickle=False) as archive:
        if archive["format_version"].item() != CACHE_FORMAT_VERSION:
            raise ValueError("特征缓存格式版本不兼容")
        columns = archive["columns"]
        if (
            columns.ndim != 1
            or columns.dtype.kind != "U"
            or not len(columns)
            or len(set(columns)) != len(columns)
        ):
            raise ValueError("特征缓存列名无效")
        values = {}
        rows = None
        for index, name in enumerate(columns.tolist()):
            column = archive[f"column_{index}"]
            if (
                column.ndim != 1
                or column.dtype.kind not in "biufU"
                or (rows is not None and len(column) != rows)
            ):
                raise ValueError("特征缓存数据类型或行数无效")
            rows = len(column)
            if column.dtype.kind == "U":
                missing = archive[f"missing_{index}"]
                if missing.dtype.kind != "b" or missing.shape != column.shape:
                    raise ValueError("特征缓存缺失值标记无效")
                column = column.astype(object)
                column[missing] = None
            values[name] = column
    frame = pd.DataFrame(values)
    if frame.empty:
        raise ValueError("特征缓存为空")
    return frame


def cache_usable(path: Path) -> bool:
    if not path.is_file():
        return False
    try:
        load_frame(path)
    except Exception:  # noqa: BLE001 -- malformed/incompatible caches must be rebuilt
        return False
    return True
