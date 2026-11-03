"""Registered BatteryLife files can be explored without changing source data."""

import json
import pickle
from pathlib import Path

import numpy as np
import pytest

from batteryland.common.errors import DomainError
from batteryland.common.storage import LocalSourceFiles
from batteryland.config import Settings
from batteryland.datasets.battery_detail import BatteryDetailService
from batteryland.datasets.catalog import FixedCatalogIndexer
from batteryland.datasets.service import ResourceService
from batteryland.datasets.splits import SplitService
from batteryland.db.database import Database
from batteryland.documents.store import SQLiteDocumentStore


def registered_cell(tmp_path: Path, *, source_name: str = "CALB", filename: str = "A.pkl"):
    root = tmp_path / "dataset"
    folder = root / source_name
    labels = root / "Life labels"
    folder.mkdir(parents=True)
    labels.mkdir()
    cell = folder / filename
    data = {
        "form_factor": "prismatic",
        "cathode_material": "LiFePO4",
        "nominal_capacity_in_Ah": 2.0,
        "charge_protocol": [{"rate_in_C": 1.0, "start_soc": 0, "end_soc": 1}],
        "cycle_data": [
            {
                "cycle_number": 1,
                "time_in_s": np.array([0.0, 60.0]),
                "voltage_in_V": np.array([3.1, 3.2]),
                "current_in_A": np.array([1.0, 1.0]),
                "discharge_capacity_in_Ah": np.array([0.0, 2.0]),
            },
            {
                "cycle_number": 3,
                "time_in_s": np.array([0.0, 60.0]),
                "voltage_in_V": np.array([3.2, 3.1]),
                "current_in_A": np.array([-1.0, -1.0]),
                "discharge_capacity_in_Ah": np.array([0.0, 1.8]),
            },
            {
                "cycle_number": 3,
                "voltage_in_V": [3.0, 2.9],
                "discharge_capacity_in_Ah": [None, None],
            },
        ],
    }
    cell.write_bytes(pickle.dumps(data))
    label_key = filename.replace("--", "-#") if source_name == "Tongji" else filename
    (labels / "labels.json").write_text(json.dumps({label_key: 1000}), encoding="utf-8")
    settings = Settings(data_dir=tmp_path / "var", source_roots={"battery_life": root})
    database = Database(tmp_path / "platform.sqlite")
    database.initialize()
    resources = ResourceService(database.unit_of_work, LocalSourceFiles(settings.source_roots))
    splits = SplitService(database.unit_of_work, SQLiteDocumentStore(database.unit_of_work))
    FixedCatalogIndexer(settings, resources, database.unit_of_work, splits).index()
    with database.unit_of_work() as unit:
        source = next(
            item
            for item in unit.resources.list_sources(1, 20)["items"]
            if item["name"] == source_name
        )
        battery = unit.resources.find_battery(source["id"], filename)
    assert battery is not None
    return BatteryDetailService(settings, database.unit_of_work), battery["id"], cell, database


def test_summary_preserves_actual_cycles_and_out_of_range_label(tmp_path: Path) -> None:
    service, battery_id, path, database = registered_cell(tmp_path)
    before = path.read_bytes()

    result = service.summary(battery_id)

    assert result["cycle_count"] == 3
    assert [row["number"] for row in result["cycles"]] == [1, 3, 3]
    assert [row["index"] for row in result["cycles"]] == [0, 1, 2]
    assert result["cycles"][1]["relative_capacity_percent"] == pytest.approx(90)
    assert result["cycles"][2]["relative_capacity_percent"] is None
    assert result["max_recorded_cycle"] == 3
    assert result["life_label"] == 1000
    assert result["life_label_file"] == "labels.json"
    assert result["metadata"]["form_factor"] == "prismatic"
    assert result["registered_metadata"] == {}
    assert path.read_bytes() == before
    database.engine.dispose()


def test_cycle_sampling_uses_record_index_and_keeps_endpoints(tmp_path: Path) -> None:
    service, battery_id, path, database = registered_cell(tmp_path)
    data = pickle.loads(path.read_bytes())
    values = np.arange(3601, dtype=float)
    data["cycle_data"][1]["time_in_s"] = values
    data["cycle_data"][1]["voltage_in_V"] = values / 1000 + 3
    path.write_bytes(pickle.dumps(data))

    result = service.cycle(battery_id, 1)

    assert result["number"] == 3
    assert result["point_count"] == 3601
    assert result["sample_indices"][0] == 0
    assert result["sample_indices"][-1] == 3600
    assert len(result["points"]) == 1800
    assert result["points"][0][0] == 0
    assert result["points"][-1][0] == 60
    assert service.cycle(battery_id, 2)["number"] == 3
    database.engine.dispose()


def test_tongji_label_key_and_invalid_record_index(tmp_path: Path) -> None:
    service, battery_id, _path, database = registered_cell(
        tmp_path, source_name="Tongji", filename="cell--2.pkl"
    )
    assert service.summary(battery_id)["life_label"] == 1000
    with pytest.raises(DomainError) as error:
        service.cycle(battery_id, 9)
    assert error.value.symbol == "not_found"
    database.engine.dispose()


def test_missing_label_and_changed_source_invalidate_summary(tmp_path: Path) -> None:
    service, battery_id, path, database = registered_cell(tmp_path)
    assert service.summary(battery_id)["life_label"] == 1000
    (path.parent.parent / "Life labels" / "labels.json").unlink()
    data = pickle.loads(path.read_bytes())
    data["cycle_data"][1]["discharge_capacity_in_Ah"] = np.array([0.0, 1.5, 1.6])
    path.write_bytes(pickle.dumps(data))

    updated = service.summary(battery_id)

    assert updated["life_label"] is None
    assert updated["life_label_file"] is None
    assert updated["cycles"][1]["relative_capacity_percent"] == pytest.approx(80)
    database.engine.dispose()


def test_corrupt_file_returns_error_without_disclosing_path(tmp_path: Path) -> None:
    service, battery_id, path, database = registered_cell(tmp_path)
    path.write_bytes(b"not a pickle")
    with pytest.raises(DomainError) as error:
        service.summary(battery_id)
    assert error.value.symbol == "storage_corrupt"
    assert str(path) not in error.value.message
    database.engine.dispose()
