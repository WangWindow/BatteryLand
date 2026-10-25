from pathlib import Path

import pytest
from sqlalchemy import text

from batteryland.common.storage import LocalSourceFiles
from batteryland.datasets.service import ResourceService
from batteryland.datasets.split_repository import SqlSplitRepository
from batteryland.datasets.split_routes import Split
from batteryland.datasets.splits import SplitService
from batteryland.db.database import Database
from batteryland.documents.store import SQLiteDocumentStore


def setup_split(tmp_path: Path):
    root = tmp_path / "source"
    root.mkdir()
    database = Database(tmp_path / "platform.sqlite")
    database.initialize()
    units = database.unit_of_work
    resources = ResourceService(units, LocalSourceFiles({"demo": root}))
    source = resources.create_source("Demo", "demo")
    resources.import_batteries(
        source["id"],
        [
            {"file_name": "a.pkl", "metadata": {"capacity": 1.0, "chemistry": "NMC"}},
            {"file_name": "b.pkl", "metadata": {"capacity": 2.0, "chemistry": "LFP"}},
        ],
    )
    batteries = resources.list_batteries({"source_id": source["id"]}, 1, 10)["items"]
    by_name = {battery["file_name"]: battery for battery in batteries}
    splits = SplitService(units, SQLiteDocumentStore(units, tmp_path / "documents"))
    body = {
        "name": "Measured",
        "source_id": source["id"],
        "expected_source_revision": resources.list_sources(1, 10)["items"][0]["revision"],
        "battery_ids": [by_name["a.pkl"]["id"], by_name["b.pkl"]["id"]],
        "method": "manual",
        "partitions": {
            "train": [by_name["a.pkl"]["id"]],
            "val": [by_name["b.pkl"]["id"]],
            "test": [],
        },
    }
    return database, resources, splits, source, by_name, body


def test_split_statistics_are_versioned_and_survive_reopen(tmp_path: Path) -> None:
    database, resources, splits, source, by_name, body = setup_split(tmp_path)
    created = splits.create(body)

    Split.model_validate(created)
    assert created["statistics"]["scopes"]["all"]["attributes"]["capacity"]["mean"] == 1.5
    assert created["statistics"]["scopes"]["train"]["attributes"]["capacity"]["mean"] == 1.0

    revised = body | {
        "partitions": {
            "train": [by_name["b.pkl"]["id"]],
            "val": [by_name["a.pkl"]["id"]],
            "test": [],
        }
    }
    splits.update(created["id"], revised, 1)
    old_version = splits.get(created["id"], 1)
    new_version = splits.get(created["id"], 2)
    assert old_version["statistics"]["scopes"]["train"]["attributes"]["capacity"]["mean"] == 1.0
    assert new_version["statistics"]["scopes"]["train"]["attributes"]["capacity"]["mean"] == 2.0

    database.engine.dispose()
    reopened = Database(tmp_path / "platform.sqlite")
    reopened.initialize()
    restored = SplitService(
        reopened.unit_of_work,
        SQLiteDocumentStore(reopened.unit_of_work, tmp_path / "documents"),
    ).get(created["id"], 1)
    assert restored["statistics"] == old_version["statistics"]
    reopened.engine.dispose()


def test_legacy_version_statistics_are_backfilled_on_detail_read(tmp_path: Path) -> None:
    database, _, splits, _, _, body = setup_split(tmp_path)
    created = splits.create(body)
    with database.engine.begin() as connection:
        document_id = connection.scalar(
            text(
                "SELECT id FROM document_versions "
                "WHERE kind = 'split' AND owner_id = :owner_id AND version = 1"
            ),
            {"owner_id": created["id"]},
        )
        connection.execute(
            text("DELETE FROM dataset_statistics WHERE document_id = :document_id"),
            {"document_id": document_id},
        )

    loaded = splits.get(created["id"], 1)

    assert loaded["statistics"]["scopes"]["all"]["sample_count"] == 2
    with database.engine.connect() as connection:
        stored = connection.scalar(
            text("SELECT COUNT(*) FROM dataset_statistics WHERE document_id = :document_id"),
            {"document_id": document_id},
        )
    assert stored == 1
    database.engine.dispose()


def test_split_and_statistics_roll_back_together_when_profile_write_fails(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    database, _, splits, source, _, body = setup_split(tmp_path)

    def fail_profile(self, document_id, profile):
        raise RuntimeError("statistics unavailable")

    monkeypatch.setattr(SqlSplitRepository, "add_statistics", fail_profile, raising=False)
    with pytest.raises(RuntimeError, match="statistics unavailable"):
        splits.create(body)

    assert splits.list(source["id"], None, 1, 10)["total"] == 0
    database.engine.dispose()
