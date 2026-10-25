from pathlib import Path

from batteryland.common.storage import LocalSourceFiles
from batteryland.datasets.service import ResourceService
from batteryland.db.database import Database


def test_source_listing_counts_registered_batteries_and_revision_updates(tmp_path: Path) -> None:
    source_root = tmp_path / "source"
    source_root.mkdir()
    database = Database(tmp_path / "platform.sqlite")
    database.initialize()
    service = ResourceService(database.unit_of_work, LocalSourceFiles({"demo": source_root}))

    source = service.create_source("Demo", "demo")
    initial = service.list_sources(1, 10)["items"][0]
    assert initial["battery_count"] == 0

    first = service.import_batteries(source["id"], [{"file_name": "a.pkl"}])
    assert first == {"imported": 1, "existing": 0, "errors": []}
    after_import = service.list_sources(1, 10)["items"][0]
    assert after_import["battery_count"] == 1
    assert after_import["revision"] == source["revision"] + 1

    duplicate = service.import_batteries(source["id"], [{"file_name": "a.pkl"}])
    assert duplicate["existing"] == 1
    assert service.list_sources(1, 10)["items"][0]["revision"] == after_import["revision"]
    database.engine.dispose()


def test_source_listing_counts_are_scoped_and_paged(tmp_path: Path) -> None:
    source_root = tmp_path / "source"
    other_root = tmp_path / "other"
    source_root.mkdir()
    other_root.mkdir()
    database = Database(tmp_path / "platform.sqlite")
    database.initialize()
    service = ResourceService(
        database.unit_of_work,
        LocalSourceFiles({"demo": source_root, "other": other_root}),
    )
    demo = service.create_source("Demo", "demo")
    other = service.create_source("Other", "other")
    service.import_batteries(demo["id"], [{"file_name": "a.pkl"}, {"file_name": "b.pkl"}])
    service.import_batteries(other["id"], [{"file_name": "a.pkl"}])

    page = service.list_sources(1, 1)

    assert page["total"] == 2
    assert len(page["items"]) == 1
    assert page["items"][0]["battery_count"] == 1
    database.engine.dispose()
