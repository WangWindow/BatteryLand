from pathlib import Path

import pytest

from batteryland.application.resources import ResourceService
from batteryland.domain.errors import DomainError
from batteryland.infrastructure.files import LocalSourceFiles
from batteryland.infrastructure.persistence.database import Database


def test_source_file_discovery_is_scoped_searchable_and_paged(tmp_path: Path) -> None:
    root = tmp_path / "calce"
    nested = root / "subset"
    hidden = root / ".hidden"
    nested.mkdir(parents=True)
    hidden.mkdir()
    (root / "A.pkl").write_bytes(b"a")
    (root / "B.PKL").write_bytes(b"bb")
    (root / "readme.txt").write_text("ignore")
    (root / ".private.pkl").write_bytes(b"ignore")
    (nested / "C.pkl").write_bytes(b"ccc")
    (nested / "deep").mkdir()
    (nested / "deep" / "D.pkl").write_bytes(b"ignore")
    (hidden / "E.pkl").write_bytes(b"ignore")
    outside = tmp_path / "outside.pkl"
    outside.write_bytes(b"outside")
    (root / "linked.pkl").symlink_to(outside)

    files = LocalSourceFiles({"calce": root})

    result = files.list_files("calce", None, 1, 2)
    assert result["total"] == 3
    assert [item["file_name"] for item in result["items"]] == ["A.pkl", "B.PKL"]
    assert all(item["importable"] for item in result["items"])
    second = files.list_files("calce", "c", 1, 50)
    assert second["total"] == 1
    assert second["items"][0]["relative_key"] == "subset/C.pkl"
    assert second["items"][0]["size_bytes"] == 3
    assert all(not Path(item["relative_key"]).is_absolute() for item in result["items"])


def test_duplicate_basenames_are_visible_but_not_importable(tmp_path: Path) -> None:
    root = tmp_path / "data"
    (root / "one").mkdir(parents=True)
    (root / "two").mkdir()
    (root / "one" / "same.pkl").write_bytes(b"one")
    (root / "two" / "same.pkl").write_bytes(b"two")

    result = LocalSourceFiles({"demo": root}).list_files("demo", None, 1, 20)

    assert result["total"] == 2
    assert all(not item["importable"] for item in result["items"])
    assert {item["reason"] for item in result["items"]} == {"duplicate_file_name"}


def test_source_options_explain_configured_directories_without_paths(tmp_path: Path) -> None:
    root = tmp_path / "Battery Data" / "CALCE"
    root.mkdir(parents=True)
    (root / "a.pkl").write_bytes(b"a")

    option = LocalSourceFiles({"calce": root}).options()[0]

    assert option == {
        "root_alias": "calce",
        "display_name": "CALCE",
        "availability": "available",
        "file_count": 1,
    }
    assert str(tmp_path) not in str(option)


def test_resource_service_scans_only_the_registered_source_root(tmp_path: Path) -> None:
    root = tmp_path / "source"
    root.mkdir()
    (root / "a.pkl").write_bytes(b"a")
    database = Database(tmp_path / "platform.sqlite")
    database.initialize()
    service = ResourceService(database.unit_of_work, LocalSourceFiles({"demo": root}))
    source = service.create_source("Demo", "demo")

    result = service.list_source_files(source["id"], None, 1, 50)

    assert result["total"] == 1
    assert result["items"][0]["file_name"] == "a.pkl"
    with pytest.raises(DomainError, match="not found"):
        service.list_source_files("00000000-0000-0000-0000-000000000000", None, 1, 50)
    database.engine.dispose()
