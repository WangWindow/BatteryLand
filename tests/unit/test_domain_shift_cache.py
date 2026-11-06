"""Feature caches must survive interpreter dependencies and recover from unreadable files."""

import pickle

import numpy as np
import pandas as pd
import pytest

from batteryland.common.errors import DomainError
from batteryland.domain_shift import data
from batteryland.domain_shift.cache import (
    CACHE_FORMAT_VERSION,
    cache_usable,
    load_frame,
    save_frame,
)


def test_cache_roundtrip_preserves_strings_missing_values_and_embedding_precision(
    tmp_path, monkeypatch
):
    frame = pd.DataFrame(
        {
            "dataset": pd.Series(["电池域", ""], dtype="string"),
            "cell_uid": pd.Series(["XJTU/电池-1", None], dtype="string"),
            "cycle_number": [1, 2],
            "embedding_0000": [np.float64(0.123456789012345), np.nan],
            "nullable_count": pd.Series([3, None], dtype="Int64"),
        }
    )
    frame.attrs["producer_only_metadata"] = object()
    path = tmp_path / "features.npz"
    save_frame(path, frame)

    def unavailable_pickle(*args, **kwargs):
        raise ModuleNotFoundError("No module named 'pyarrow'")

    monkeypatch.setattr(pd, "read_pickle", unavailable_pickle)
    restored = load_frame(path)
    assert restored["dataset"].tolist() == ["电池域", ""]
    assert restored["cell_uid"].iloc[0] == "XJTU/电池-1"
    assert pd.isna(restored["cell_uid"].iloc[1])
    np.testing.assert_equal(
        restored["embedding_0000"].to_numpy(), frame["embedding_0000"].to_numpy()
    )
    np.testing.assert_equal(restored["nullable_count"].to_numpy(), [3.0, np.nan])
    assert cache_usable(path)
    with np.load(path, allow_pickle=False) as archive:
        assert all(archive[key].dtype.kind != "O" for key in archive.files)
    assert list(tmp_path.glob("*.tmp")) == []


def test_old_pickles_and_corrupt_cache_are_rebuilt_instead_of_reported_ready(tmp_path):
    source = tmp_path / "cell.pkl"
    with source.open("wb") as stream:
        pickle.dump(
            {
                "cell_id": "cell",
                "nominal_capacity_in_Ah": 2.0,
                "cycle_data": [
                    {
                        "current_in_A": [1.0, 1.0, -1.0, -1.0],
                        "voltage_in_V": [3.0, 4.0, 3.8, 3.0],
                        "charge_capacity_in_Ah": [0.0, 1.8, 0.0, 0.0],
                        "discharge_capacity_in_Ah": [0.0, 0.0, 0.5, 1.7],
                        "time_in_s": [0.0, 100.0, 200.0, 300.0],
                    }
                ],
            },
            stream,
        )
    datasets = {"source": [source]}
    directory = tmp_path / "cache"
    target = data.cache_file(directory, "source", source, 1)
    legacy = directory / "v5_s1" / "source" / target.with_suffix(".pkl").name
    legacy.parent.mkdir(parents=True)
    legacy.write_bytes(b"old pandas/pyarrow pickle")
    assert data.cache_status(datasets, ["source"], 1, directory)["source"] == (0, 1)
    target.parent.mkdir(parents=True)
    target.write_bytes(b"incomplete npz cache")
    assert data.cache_status(datasets, ["source"], 1, directory)["source"] == (0, 1)
    with pytest.raises(DomainError, match="请重新提取"):
        data.load_features(datasets, ["source"], 1, directory)
    assert data.build_features(datasets, ["source"], 1, directory) == {
        "built": 1,
        "failed": [],
        "total": 1,
    }
    assert data.cache_status(datasets, ["source"], 1, directory)["source"] == (1, 1)
    assert len(data.load_features(datasets, ["source"], 1, directory)) == 1
    assert legacy.read_bytes() == b"old pandas/pyarrow pickle"


def test_object_arrays_are_not_loaded_as_feature_caches(tmp_path):
    path = tmp_path / "opaque.npz"
    np.savez(
        path,
        format_version=np.asarray(CACHE_FORMAT_VERSION),
        columns=np.asarray(["feature"]),
        column_0=np.asarray([object()], dtype=object),
    )
    assert not cache_usable(path)
    with pytest.raises(ValueError, match="Object arrays"):
        load_frame(path)
