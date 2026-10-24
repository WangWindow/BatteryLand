from pathlib import Path

import pytest

from batteryland.application.resources import ResourceService
from batteryland.application.splits import SplitService
from batteryland.domain.errors import DomainError
from batteryland.domain.splits import make_split
from batteryland.infrastructure.documents import SQLiteDocumentStore
from batteryland.infrastructure.files import LocalSourceFiles
from batteryland.infrastructure.persistence.database import Database


def test_seeded_split_is_repeatable_and_preserves_all_members() -> None:
    ids = [str(index) for index in range(11)]
    options = {"method": "random", "ratios": {"train": 0.6, "val": 0.2, "test": 0.2}, "seed": 42}
    first = make_split(ids, {key: key for key in ids}, **options)
    assert first == make_split(list(reversed(ids)), {key: key for key in ids}, **options)
    assert {name: len(members) for name, members in first.items()} == {
        "train": 7,
        "val": 2,
        "test": 2,
    }
    assert set(sum(first.values(), [])) == set(ids)


def test_overlaps_and_physical_battery_leakage_are_rejected() -> None:
    with pytest.raises(DomainError):
        make_split(["a"], {"a": "a"}, "manual", {"train": ["a"], "val": ["a"], "test": []})
    with pytest.raises(DomainError):
        make_split(
            ["a", "b"],
            {"a": "same", "b": "same"},
            "manual",
            {"train": ["a"], "val": ["b"], "test": []},
        )


def test_hybrid_preserves_fixed_members_and_groups_related_samples() -> None:
    ids = ["a", "a-window", "b", "c", "d"]
    result = make_split(
        ids,
        {key: "a" if key.startswith("a") else key for key in ids},
        "hybrid",
        {"train": [], "val": ["a"], "test": []},
        {"train": 0.5, "val": 0.25, "test": 0.25},
        1,
    )
    assert result["val"] == ["a", "a-window"]
    assert len(result["train"]) == 2
    with pytest.raises(DomainError):
        make_split(
            ["a", "b", "c", "d"],
            {key: key for key in "abcd"},
            "hybrid",
            {"train": ["a", "b", "c"], "val": [], "test": []},
            {"train": 0.5, "val": 0.25, "test": 0.25},
            1,
        )


def test_manual_empty_groups_are_preserved_and_bad_proportions_fail() -> None:
    assert make_split(["a"], {"a": "a"}, "manual", {"train": ["a"], "val": [], "test": []}) == {
        "train": ["a"],
        "val": [],
        "test": [],
    }
    with pytest.raises(DomainError):
        make_split(["a"], {"a": "a"}, "random", ratios={"train": 1, "val": 1, "test": 0}, seed=42)


def test_whole_source_split_uses_registered_members_and_expected_revision(tmp_path: Path) -> None:
    root = tmp_path / "source"
    root.mkdir()
    database = Database(tmp_path / "platform.sqlite")
    database.initialize()
    files = LocalSourceFiles({"demo": root})
    resources = ResourceService(database.unit_of_work, files)
    source = resources.create_source("Demo", "demo")
    resources.import_batteries(source["id"], [{"file_name": "root.pkl"}])
    root_battery = resources.list_batteries({"source_id": source["id"]}, 1, 10)["items"][0]
    resources.import_batteries(
        source["id"],
        [
            {"file_name": "child.pkl", "parent_battery_id": root_battery["id"]},
            {"file_name": "other.pkl"},
        ],
    )
    source_revision = resources.list_sources(1, 10)["items"][0]["revision"]
    batteries = resources.list_batteries({"source_id": source["id"]}, 1, 10)["items"]
    splits = SplitService(
        database.unit_of_work, SQLiteDocumentStore(database.unit_of_work, tmp_path / "documents")
    )

    split = splits.create(
        {
            "name": "Whole source",
            "source_id": source["id"],
            "battery_ids": [],
            "include_all_source": True,
            "expected_source_revision": source_revision,
            "method": "random",
            "ratios": {"train": 1.0, "val": 0.0, "test": 0.0},
            "seed": 42,
        }
    )

    assert sum(split["counts"].values()) == 3
    memberships = [
        {member for member in split["payload"][partition]} for partition in ("train", "val", "test")
    ]
    assert set().union(*memberships) == {battery["id"] for battery in batteries}
    child = next(battery for battery in batteries if battery["file_name"] == "child.pkl")
    assert any(root_battery["id"] in group and child["id"] in group for group in memberships)

    with pytest.raises(DomainError, match="revision"):
        splits.create(
            {
                "name": "Stale source",
                "source_id": source["id"],
                "battery_ids": [],
                "include_all_source": True,
                "expected_source_revision": source_revision - 1,
                "method": "random",
                "ratios": {"train": 1.0, "val": 0.0, "test": 0.0},
                "seed": 42,
            }
        )
    database.engine.dispose()


def test_preview_returns_exact_counts_without_saving_a_split(tmp_path: Path) -> None:
    root = tmp_path / "source"
    root.mkdir()
    database = Database(tmp_path / "platform.sqlite")
    database.initialize()
    resources = ResourceService(database.unit_of_work, LocalSourceFiles({"demo": root}))
    source = resources.create_source("Demo", "demo")
    resources.import_batteries(source["id"], [{"file_name": name} for name in ("a.pkl", "b.pkl")])
    source_revision = resources.list_sources(1, 10)["items"][0]["revision"]
    splits = SplitService(
        database.unit_of_work, SQLiteDocumentStore(database.unit_of_work, tmp_path / "documents")
    )

    body = {
        "name": "Preview only",
        "source_id": source["id"],
        "battery_ids": [],
        "include_all_source": True,
        "expected_source_revision": source_revision,
        "method": "random",
        "ratios": {"train": 1.0, "val": 0.0, "test": 0.0},
        "seed": 42,
    }
    result = splits.preview(body)

    assert result == {
        "source_revision": source_revision,
        "counts": {"all": 2, "train": 2, "val": 0, "test": 0},
    }
    assert splits.list(source["id"], None, 1, 10)["total"] == 0
    created = splits.create(body)
    assert created["counts"] == {"train": result["counts"]["train"], "val": 0, "test": 0}
    database.engine.dispose()


def test_preview_rejects_a_source_without_registered_batteries(tmp_path: Path) -> None:
    root = tmp_path / "source"
    root.mkdir()
    database = Database(tmp_path / "platform.sqlite")
    database.initialize()
    resources = ResourceService(database.unit_of_work, LocalSourceFiles({"demo": root}))
    source = resources.create_source("Empty", "demo")
    source_revision = resources.list_sources(1, 10)["items"][0]["revision"]
    splits = SplitService(
        database.unit_of_work, SQLiteDocumentStore(database.unit_of_work, tmp_path / "documents")
    )

    with pytest.raises(DomainError, match="at least one"):
        splits.preview(
            {
                "name": "Empty dataset",
                "source_id": source["id"],
                "expected_source_revision": source_revision,
                "battery_ids": [],
                "include_all_source": True,
                "method": "random",
                "ratios": {"train": 1.0, "val": 0.0, "test": 0.0},
                "seed": 42,
            }
        )
    database.engine.dispose()
