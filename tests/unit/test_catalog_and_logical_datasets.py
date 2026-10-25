from pathlib import Path

from batteryland.common.storage import LocalSourceFiles
from batteryland.config import Settings
from batteryland.datasets.catalog import FixedCatalogIndexer
from batteryland.datasets.logical import LogicalDatasetService
from batteryland.datasets.service import ResourceService
from batteryland.datasets.splits import SplitService
from batteryland.db.database import Database
from batteryland.documents.store import SQLiteDocumentStore


def _services(root: Path, data_dir: Path):
    settings = Settings(data_dir=data_dir, source_roots={"open_data": root})
    database = Database(data_dir / "platform.sqlite")
    database.initialize()
    resources = ResourceService(database.unit_of_work, LocalSourceFiles(settings.source_roots))
    indexer = FixedCatalogIndexer(settings, resources, database.unit_of_work)
    return database, resources, indexer, LogicalDatasetService(database.unit_of_work)


def test_catalog_rescans_invalidate_logical_datasets_and_use_sqlite_for_browsing(tmp_path: Path):
    root = tmp_path / "assets"
    group = root / "CALCE"
    group.mkdir(parents=True)
    (group / "cell-a.pkl").write_bytes(b"a")
    (group / "cell-b.pkl").write_bytes(b"b")
    database, resources, indexer, datasets = _services(root, tmp_path / "data")
    try:
        indexer.index()
        source = resources.list_sources(1, 10)["items"][0]
        assert source["name"] == "CALCE"
        assert source["available_battery_count"] == 2

        batteries = resources.list_batteries(
            {"source_id": source["id"], "availability": "available"}, 1, 10
        )["items"]
        logical = datasets.create(
            "CALCE subset",
            "",
            [
                {
                    "source_id": source["id"],
                    "expected_revision": source["revision"],
                    "battery_ids": [batteries[0]["id"]],
                }
            ],
        )
        assert logical["member_count"] == 1
        assert not logical["stale"]

        (group / "cell-b.pkl").write_bytes(b"updated bytes")
        (group / "cell-a.pkl").unlink()
        indexer.index()

        updated = resources.list_sources(1, 10)["items"][0]
        assert updated["revision"] > source["revision"]
        assert updated["battery_count"] == 2
        assert updated["available_battery_count"] == 1
        assert datasets.get(logical["id"])["stale"]
        assert indexer.status()["state"] == "ready"

        class NoFilesystemReads:
            def list_files(self, *args, **kwargs):
                raise AssertionError("catalog read unexpectedly scanned the filesystem")

            def options(self):
                raise AssertionError("catalog read unexpectedly scanned the filesystem")

            def inspect(self, *args, **kwargs):
                raise AssertionError("catalog read unexpectedly scanned the filesystem")

        resources.files = NoFilesystemReads()  # type: ignore[assignment]
        assert resources.list_source_files(source["id"], None, 1, 10)["total"] == 1
        assert resources.source_options()[0]["file_count"] == 1
    finally:
        database.engine.dispose()


def test_logical_dataset_can_be_the_input_to_a_saved_split(tmp_path: Path):
    root = tmp_path / "assets"
    group = root / "NASA"
    group.mkdir(parents=True)
    for name in ("cell-a.pkl", "cell-b.pkl", "cell-c.pkl"):
        (group / name).write_bytes(name.encode())
    database, resources, indexer, datasets = _services(root, tmp_path / "data")
    try:
        indexer.index()
        source = resources.list_sources(1, 10)["items"][0]
        batteries = resources.list_batteries(
            {"source_id": source["id"], "availability": "available"}, 1, 10
        )["items"]
        logical = datasets.create(
            "NASA experiment subset",
            "saved selection",
            [
                {
                    "source_id": source["id"],
                    "expected_revision": source["revision"],
                    "battery_ids": [item["id"] for item in batteries],
                }
            ],
        )
        splits = SplitService(database.unit_of_work, SQLiteDocumentStore(database.unit_of_work))
        split = splits.create(
            {
                "name": "NASA 70/30",
                "logical_dataset_id": logical["id"],
                "method": "random",
                "ratios": {"train": 0.7, "val": 0.3, "test": 0.0},
                "seed": 42,
            }
        )
        assert split["logical_dataset_id"] == logical["id"]
        assert sum(split["counts"].values()) == 3
    finally:
        database.engine.dispose()
