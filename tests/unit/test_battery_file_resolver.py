from pathlib import Path

import pytest

from batteryland.common.errors import DomainError
from batteryland.training.resources import BatteryFileResolver


def test_resolver_deduplicates_same_name_and_chooses_stable_relative_path(tmp_path: Path):
    root = tmp_path / "pool"
    for relative in ("z-group/repeat.pkl", "a-group/repeat.pkl", "a-group/other.pkl"):
        path = root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"same logical battery")

    resolved = BatteryFileResolver({"pool": root}).resolve(["repeat.pkl", "other.pkl"])

    assert resolved == {
        "source": {"root_alias": "pool"},
        "batteries": [
            {"file_name": "other.pkl", "relative_key": "a-group/other.pkl"},
            {"file_name": "repeat.pkl", "relative_key": "a-group/repeat.pkl"},
        ],
    }


def test_resolver_rejects_a_missing_battery(tmp_path: Path):
    root = tmp_path / "pool"
    root.mkdir()

    with pytest.raises(DomainError, match="missing") as error:
        BatteryFileResolver({"pool": root}).resolve(["missing.pkl"])

    assert error.value.symbol == "integration_precondition_failed"
